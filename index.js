const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

// ── DATA FILE (acts as our simple database) ──
const DB_PATH = path.join(__dirname, 'db.json');

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      users: [],
      affirmations: INITIAL_AFFIRMATIONS,
      settings: {
        appName: "AffirmationsBoosten",
        trialDays: 7,
        priceMonthly: 49,
        currency: "SEK"
      }
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ── JWT SECRET (set in environment variable on Railway) ──
const JWT_SECRET = process.env.JWT_SECRET || 'ab-dev-secret-change-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123-CHANGE-ME';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@affirmationsboosten.se';

// ── MIDDLEWARE: verify token ──
function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Ingen token' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Ogiltig token' });
  }
}

function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'Ingen åtkomst' });
    next();
  });
}

// ── TRIAL CHECK ──
function hasAccess(user) {
  if (user.isAdmin) return true;
  if (user.isPaid) return true;
  const db = readDB();
  const trialDays = db.settings.trialDays || 7;
  const created = new Date(user.createdAt);
  const now = new Date();
  const diffDays = (now - created) / (1000 * 60 * 60 * 24);
  return diffDays <= trialDays;
}

// ══════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════

// Register
app.post('/api/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name)
    return res.status(400).json({ error: 'Alla fält krävs' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Lösenordet måste vara minst 6 tecken' });

  const db = readDB();
  if (db.users.find(u => u.email === email.toLowerCase()))
    return res.status(400).json({ error: 'E-postadressen är redan registrerad' });

  const hashed = await bcrypt.hash(password, 12);
  const user = {
    id: Date.now().toString(),
    email: email.toLowerCase(),
    name,
    password: hashed,
    createdAt: new Date().toISOString(),
    isPaid: false,
    isAdmin: false,
    streak: 0,
    lastRead: null,
    readCount: 0,
    journalCount: 0
  };
  db.users.push(user);
  writeDB(db);

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, isAdmin: false, isPaid: false, createdAt: user.createdAt },
    JWT_SECRET, { expiresIn: '30d' }
  );
  const access = hasAccess({ ...user, isAdmin: false });
  res.json({ token, name: user.name, access, trialActive: !user.isPaid && access });
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const db = readDB();

  // Admin login
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    const match = await bcrypt.compare(password, await bcrypt.hash(ADMIN_PASSWORD, 12).then(() => bcrypt.hash(ADMIN_PASSWORD, 12)));
    // Direct compare for admin
    if (password === ADMIN_PASSWORD) {
      const token = jwt.sign(
        { id: 'admin', email: ADMIN_EMAIL, name: 'Admin', isAdmin: true, isPaid: true, createdAt: '2024-01-01' },
        JWT_SECRET, { expiresIn: '7d' }
      );
      return res.json({ token, name: 'Admin', access: true, isAdmin: true });
    }
    return res.status(401).json({ error: 'Fel lösenord' });
  }

  const user = db.users.find(u => u.email === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Ingen användare med den e-postadressen' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Fel lösenord' });

  const access = hasAccess(user);
  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, isAdmin: false, isPaid: user.isPaid, createdAt: user.createdAt },
    JWT_SECRET, { expiresIn: '30d' }
  );
  res.json({ token, name: user.name, access, isAdmin: false, trialActive: !user.isPaid && access });
});

// Check access (called on app load)
app.get('/api/access', auth, (req, res) => {
  const db = readDB();
  const trialDays = db.settings.trialDays || 7;
  const created = new Date(req.user.createdAt);
  const now = new Date();
  const daysUsed = Math.floor((now - created) / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, trialDays - daysUsed);
  const access = hasAccess(req.user);

  res.json({
    access,
    isAdmin: req.user.isAdmin,
    isPaid: req.user.isPaid,
    trialActive: !req.user.isPaid && access,
    daysLeft,
    name: req.user.name
  });
});

// ══════════════════════════════════════
//  AFFIRMATION ROUTES
// ══════════════════════════════════════

// Get today's affirmation (free preview — first 7)
app.get('/api/affirmation/today', auth, (req, res) => {
  const db = readDB();
  const now = new Date();
  const soy = new Date(now.getFullYear(), 0, 0);
  const doy = Math.floor((now - soy) / 86400000);
  const idx = (doy - 1 + db.affirmations.length) % db.affirmations.length;

  if (!hasAccess(req.user)) {
    return res.status(403).json({ error: 'Provperioden har löpt ut', paywall: true });
  }

  res.json({
    text: db.affirmations[idx],
    index: idx + 1,
    total: db.affirmations.length,
    dayOfWeek: now.getDay()
  });
});

// Get all affirmations (requires access)
app.get('/api/affirmations', auth, (req, res) => {
  if (!hasAccess(req.user)) {
    return res.status(403).json({ error: 'Provperioden har löpt ut', paywall: true });
  }
  const db = readDB();
  res.json({ affirmations: db.affirmations });
});

// Get one affirmation by index
app.get('/api/affirmation/:index', auth, (req, res) => {
  if (!hasAccess(req.user)) {
    return res.status(403).json({ error: 'Provperioden har löpt ut', paywall: true });
  }
  const db = readDB();
  const idx = parseInt(req.params.index);
  if (idx < 0 || idx >= db.affirmations.length)
    return res.status(404).json({ error: 'Hittades inte' });
  res.json({ text: db.affirmations[idx], index: idx + 1 });
});

// ══════════════════════════════════════
//  JOURNAL ROUTES
// ══════════════════════════════════════
const JOURNAL_PATH = path.join(__dirname, 'journals');
if (!fs.existsSync(JOURNAL_PATH)) fs.mkdirSync(JOURNAL_PATH);

app.post('/api/journal', auth, (req, res) => {
  if (!hasAccess(req.user)) return res.status(403).json({ error: 'Åtkomst nekad', paywall: true });
  const { text, affirmation, mood } = req.body;
  if (!text) return res.status(400).json({ error: 'Text krävs' });

  const jPath = path.join(JOURNAL_PATH, `${req.user.id}.json`);
  const entries = fs.existsSync(jPath) ? JSON.parse(fs.readFileSync(jPath)) : [];
  const entry = {
    id: Date.now().toString(),
    date: new Date().toISOString(),
    text, affirmation, mood
  };
  entries.unshift(entry);
  fs.writeFileSync(jPath, JSON.stringify(entries.slice(0, 200)));

  // Update journal count
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (user) { user.journalCount = (user.journalCount || 0) + 1; writeDB(db); }

  res.json({ success: true, entry });
});

app.get('/api/journal', auth, (req, res) => {
  if (!hasAccess(req.user)) return res.status(403).json({ error: 'Åtkomst nekad', paywall: true });
  const jPath = path.join(JOURNAL_PATH, `${req.user.id}.json`);
  const entries = fs.existsSync(jPath) ? JSON.parse(fs.readFileSync(jPath)) : [];
  res.json({ entries });
});

// ══════════════════════════════════════
//  STREAK ROUTE
// ══════════════════════════════════════
app.post('/api/streak', auth, (req, res) => {
  if (!hasAccess(req.user)) return res.status(403).json({ error: 'Åtkomst nekad' });
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Användare ej hittad' });

  const today = new Date().toDateString();
  if (user.lastRead !== today) {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    if (user.lastRead === yesterday.toDateString()) user.streak = (user.streak || 0) + 1;
    else user.streak = 1;
    user.lastRead = today;
    user.readCount = (user.readCount || 0) + 1;
    writeDB(db);
  }
  res.json({ streak: user.streak, readCount: user.readCount });
});

// ══════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════

// Get all users
app.get('/api/admin/users', adminAuth, (req, res) => {
  const db = readDB();
  const users = db.users.map(u => ({
    id: u.id, email: u.email, name: u.name,
    createdAt: u.createdAt, isPaid: u.isPaid,
    streak: u.streak || 0, readCount: u.readCount || 0,
    journalCount: u.journalCount || 0
  }));
  res.json({ users, total: users.length, paid: users.filter(u => u.isPaid).length });
});

// Toggle paid status
app.post('/api/admin/users/:id/paid', adminAuth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Användare ej hittad' });
  user.isPaid = !user.isPaid;
  writeDB(db);
  res.json({ success: true, isPaid: user.isPaid });
});

// Get affirmations (admin)
app.get('/api/admin/affirmations', adminAuth, (req, res) => {
  const db = readDB();
  res.json({ affirmations: db.affirmations });
});

// Update single affirmation
app.put('/api/admin/affirmation/:index', adminAuth, (req, res) => {
  const db = readDB();
  const idx = parseInt(req.params.index);
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text krävs' });
  if (idx < 0 || idx >= db.affirmations.length) return res.status(404).json({ error: 'Index ogiltigt' });
  db.affirmations[idx] = text.trim();
  writeDB(db);
  res.json({ success: true });
});

// Add affirmation
app.post('/api/admin/affirmation', adminAuth, (req, res) => {
  const db = readDB();
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Text krävs' });
  db.affirmations.push(text.trim());
  writeDB(db);
  res.json({ success: true, total: db.affirmations.length });
});

// Delete affirmation
app.delete('/api/admin/affirmation/:index', adminAuth, (req, res) => {
  const db = readDB();
  const idx = parseInt(req.params.index);
  if (idx < 0 || idx >= db.affirmations.length) return res.status(404).json({ error: 'Index ogiltigt' });
  db.affirmations.splice(idx, 1);
  writeDB(db);
  res.json({ success: true, total: db.affirmations.length });
});

// Get/update settings
app.get('/api/admin/settings', adminAuth, (req, res) => {
  const db = readDB();
  res.json(db.settings);
});

app.put('/api/admin/settings', adminAuth, (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...req.body };
  writeDB(db);
  res.json({ success: true, settings: db.settings });
});

// ── SERVE APP ──
app.get('/admin*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ══════════════════════════════════════
//  365 AFFIRMATIONS DATA
// ══════════════════════════════════════
const INITIAL_AFFIRMATIONS = [
"Jag är kapabel att uppnå allt jag sätter mig för att göra.",
"Jag väljer att se möjligheter där andra ser hinder.",
"Min potential är obegränsad och jag växer varje dag.",
"Jag förtjänar kärlek, lycka och allt gott i livet.",
"Jag är stark nog att möta dagens utmaningar.",
"Varje ny dag är en ny chans att bli den bästa versionen av mig själv.",
"Jag litar på min intuition och mina beslut.",
"Mitt sinne är lugnt, mitt hjärta är öppet.",
"Jag attraherar positiva människor och situationer till mitt liv.",
"Jag är tacksam för allt jag har och allt som kommer.",
"Min energi är ett magnet för framgång och välmående.",
"Jag väljer glädje och tacksamhet varje dag.",
"Jag är värdig all den lycka som livet erbjuder.",
"Jag har kraften att förändra mitt liv till det bättre.",
"Jag omfamnar förändring och ser den som en möjlighet.",
"Mitt arbete har värde och gör skillnad i världen.",
"Jag är omgiven av kärlek och stöd.",
"Jag förlåter mig själv och andra med lätthet.",
"Varje utmaning gör mig starkare och visare.",
"Jag är redo att ta emot allt gott som livet har att erbjuda.",
"Mina drömmar är möjliga och värda att sträva efter.",
"Jag väljer att fokusera på det positiva i varje situation.",
"Jag är fri att vara den autentiska versionen av mig själv.",
"Mitt liv fylls med mening, syfte och glädje.",
"Jag tror på mig själv och mina förmågor.",
"Jag är tålmodig med mig själv under min resa.",
"Jag attraherar abundans i alla former till mitt liv.",
"Min hälsa och välmående är mina prioriteter.",
"Jag är kreativ och hittar alltid lösningar.",
"Kärleken jag ger återvänder till mig mångdubbelt.",
"Jag är i fred med mitt förflutna och öppen för framtiden.",
"Varje andetag fyller mig med lugn och klarhet.",
"Jag väljer att leva i nuet och njuta av varje ögonblick.",
"Mina relationer är fyllda med respekt, kärlek och förståelse.",
"Jag är tillräcklig, precis som jag är just nu.",
"Framgång flödar naturligt till mig.",
"Jag har modet att följa min passion.",
"Mitt hjärta är öppet för nya möjligheter och äventyr.",
"Jag är välsignad med unika talanger och förmågor.",
"Jag väljer att se skönheten i det vardagliga.",
"Jag är resilient och återhämtar mig från alla motgångar.",
"Varje dag lär jag mig något nytt och värdefullt.",
"Jag inspirerar andra bara genom att vara mig själv.",
"Min kraft och styrka kommer inifrån.",
"Jag är öppen för att ta emot hjälp och stöd.",
"Jag skapar ett liv som speglar mina djupaste värderingar.",
"Mitt sinne är skarpt, min kropp är stark.",
"Jag väljer tankar som stärker och uppliftar mig.",
"Jag är en kraftfull skapare av min egen verklighet.",
"Glädje är mitt naturliga tillstånd.",
"Jag är djärv, modig och orädd.",
"Mitt liv är ett mästerverk under skapande.",
"Jag välkomnar fred och harmoni in i mitt liv.",
"Jag är tacksam för alla lektioner livet ger mig.",
"Mina drömmar tar form och manifesteras.",
"Jag litar på livets process och flöde.",
"Jag är full av energi och vitalitet.",
"Framtiden är ljus och fylld med möjligheter.",
"Jag är en välsignelse för alla jag möter.",
"Jag är i harmoni med mig själv och universum.",
"Jag förtjänar det allra bästa i varje aspekt av livet.",
"Min intuition leder mig alltid rätt.",
"Jag är omgiven av överflöd och välstånd.",
"Varje dag tar jag ett steg närmare mina mål.",
"Jag väljer kärlek framför rädsla i varje situation.",
"Jag är ett barn av universum, älskad och välsignad.",
"Min röst är viktig och förtjänar att höras.",
"Jag är kapabel att hantera allt som kommer i min väg.",
"Jag omfamnar min unikhet och det som gör mig speciell.",
"Positiva förändringar händer i mitt liv just nu.",
"Jag är ett ljus för dem runt omkring mig.",
"Mitt liv har syfte och mening.",
"Jag väljer tillit framför oro.",
"Jag är fri från begränsande övertygelser.",
"Kärlek och tacksamhet är grunden i mitt liv.",
"Jag är öppen för mirakel och oväntade välsignelser.",
"Mina handlingar skapar positiva resultat.",
"Jag är beständig och ger inte upp.",
"Min kreativitet flödar fritt och rikligt.",
"Jag är ett med naturen och världen runt mig.",
"Jag väljer att leva med intention och medvetenhet.",
"Mitt arbete bidrar positivt till världen.",
"Jag är i ständig tillväxt och utveckling.",
"Jag attraherar det jag ger energi till.",
"Jag är fri att skapa det liv jag verkligen önskar.",
"Välmående är mitt naturliga tillstånd.",
"Jag omfamnar det okända med nyfikenhet och öppenhet.",
"Jag är ett med mina drömmar och mina mål.",
"Kärlek strömmar genom mig och ut i världen.",
"Jag är i perfekt balans i kropp, sinne och själ.",
"Varje morgon vaknar jag upp tacksam och ivrig.",
"Jag tillåter mig att ta plats i världen.",
"Mina relationer djupnar och blomstrar.",
"Jag är full av glädje och tacksamhet för livet.",
"Jag väljer att se godhet i alla och allt.",
"Mitt liv är en resa och jag njuter av varje steg.",
"Jag är välförsedd med allt jag behöver.",
"Jag är en kraftkälla av positivitet och kärlek.",
"Framgång är min födelserätt.",
"Jag är trygg, skyddad och älskad.",
"Mitt hjärta är fullt av tacksamhet och kärlek.",
"Jag väljer att leva med lätthet och glädje.",
"Jag omfamnar min styrka och sårbarhet.",
"Jag är öppen för livets rika möjligheter.",
"Jag förtjänar att bli hörsammad och respekterad.",
"Mitt liv blomstrar i alla riktningar.",
"Jag är kapabel att skapa den förändring jag vill se.",
"Jag väljer fred och harmoni i mina relationer.",
"Mitt sinne är klart och mitt hjärta är rent.",
"Jag är tacksam för min hälsa och vitalitet.",
"Jag väljer att ge och ta emot kärlek fritt.",
"Jag är på exakt rätt plats i mitt liv just nu.",
"Mina handlingar inspireras av kärlek och medkänsla.",
"Jag är fullständigt kapabel att uppnå mina mål.",
"Varje dag är en present fylld med möjligheter.",
"Jag väljer att växa och lära mig av varje erfarenhet.",
"Jag är en magnet för positivitet och lycka.",
"Mitt liv är en vacker berättelse som jag skriver.",
"Jag är tacksam för alla de som älskar mig.",
"Jag väljer mod framför rädsla varje gång.",
"Jag förtjänar att vara lycklig och blomstra.",
"Jag är omgiven av magi och underbara möjligheter.",
"Min ande är oövervinnlig och full av kraft.",
"Jag väljer att leva med passion och entusiasm.",
"Jag är i fred med vem jag är och vem jag blir.",
"Mitt arbete skapar välstånd och överflöd.",
"Jag är fylld med glädje, kärlek och tacksamhet.",
"Varje utmaning leder mig till min bästa version.",
"Jag väljer att se skönhet och underverk varje dag.",
"Mitt hjärta är öppet och mottagligt för kärlek.",
"Jag är en positiv kraft i världen.",
"Jag väljer att leva autentiskt och ärligt.",
"Jag är redo att ta emot alla livets goda gåvor.",
"Min resa är unik och värdefull.",
"Jag väljer glädje, kärlek och fred varje dag.",
"Jag är välsignad med oändliga möjligheter.",
"Mitt liv är ett mästerverk av kärlek och mening.",
"Jag är stark, modig och redo för allt.",
"Jag väljer att leva med ett öppet och tacksamt hjärta.",
"Jag förtjänar lycka, framgång och kärlek.",
"Jag är i ett konstant tillstånd av tillväxt och blomstring.",
"Mitt sinne är klart och fokuserat på det goda.",
"Jag väljer att omfamna livet i all dess rikedom.",
"Kärlek och välmående flödar rikligt i mitt liv.",
"Jag väljer att leva varje dag med intention.",
"Jag är tacksam för allt det goda i mitt liv.",
"Mitt liv fylls med mening och syfte.",
"Jag väljer att se varje dag som en gåva.",
"Jag är stark nog att förverkliga mina drömmar.",
"Mitt hjärta är fyllt med kärlek och tacksamhet.",
"Jag väljer att se möjligheter i varje situation.",
"Jag är ett ljus av hopp och inspiration.",
"Varje dag tar jag steg mot ett mer uppfyllt liv.",
"Jag väljer att leva med glädje och lätthet.",
"Jag är välsignad och omgiven av kärlek.",
"Mitt sinne är lugnt och mitt hjärta är tryggt.",
"Jag väljer att omfamna det okända med öppenhet.",
"Jag är full av potential och möjligheter.",
"Kärlek och positiva tankar leder mitt liv.",
"Jag väljer att ta hand om mig själv med kärlek.",
"Jag är i perfekt harmoni med livet.",
"Mitt liv blomstrar och växer i alla riktningar.",
"Jag väljer att leva med tacksamhet och glädje.",
"Jag är kapabel att skapa den förändring jag önskar.",
"Varje ny morgon är en ny chans till välmående.",
"Jag väljer att fokusera på det som ger mig energi.",
"Jag är omgiven av positiva och kärleksfulla människor.",
"Mitt arbete är meningsfullt och gör skillnad.",
"Jag väljer att leva modigt och autentiskt.",
"Jag är tacksam för alla erfarenheter som format mig.",
"Mitt hjärta är öppet och fullt av kärlek.",
"Jag väljer att se det goda i varje människa.",
"Varje dag ger mig nya möjligheter att växa.",
"Jag väljer att leva med tålamod och förståelse.",
"Jag är fri att vara precis den jag är.",
"Min energi och vitalitet ökar för varje dag.",
"Jag väljer att leva med glädje och entusiasm.",
"Jag är välsignad med en stark och frisk kropp.",
"Mitt sinne är i fred och mitt hjärta är fyllt med kärlek.",
"Jag väljer att omfamna livet med öppna armar.",
"Jag är redo för alla de underbara saker livet har att erbjuda.",
"Kärlek är kärnan i allt jag gör.",
"Jag väljer att leva med mening och syfte.",
"Varje dag är fylld med underbara möjligheter.",
"Jag väljer att se världen med nyfikna och glada ögon.",
"Jag är i ständig rörelse mot mitt sanna syfte.",
"Mitt liv är rikt på erfarenheter och lärdomar.",
"Jag väljer att ge kärlek och tacksamhet fritt.",
"Varje utmaning är en möjlighet till tillväxt.",
"Jag väljer att leva med autenticitet och integritet.",
"Jag är välsignad med oändlig kärlek och stöd.",
"Mitt hjärta och mitt sinne är i perfekt harmoni.",
"Jag väljer att se varje dag som ett äventyr.",
"Jag är kapabel att skapa det liv jag drömmer om.",
"Kärlek och medkänsla guidar varje steg jag tar.",
"Jag väljer att leva med generositet och öppenhet.",
"Jag är tacksam för varje andetag och ögonblick.",
"Mitt liv är ett flöde av glädje och välmående.",
"Jag väljer att omfamna min personliga kraft.",
"Varje dag är en del av min vackra resa.",
"Jag väljer att se livet som en underskön gåva.",
"Jag är stark, hälsosam och full av vitalitet.",
"Mitt sinne skapar positiva och stärkande tankar.",
"Jag väljer att leva med hopp och tilltro.",
"Jag är välsignad med oändliga resurser och möjligheter.",
"Kärlek och tacksamhet är mitt fundament.",
"Jag väljer att vara ett positivt ljus i världen.",
"Jag är i harmoni med min kropp och mitt sinne.",
"Varje dag tar jag hand om mig själv med omsorg.",
"Jag väljer att leva med frid och glädje.",
"Mitt liv är ett verk av kärlek och skönhet.",
"Jag väljer att se det extraordinära i det ordinära.",
"Jag är redo att ta emot livets rikaste gåvor.",
"Kärlek flödar från mig till allt och alla runt mig.",
"Jag väljer att leva med visdom och förståelse.",
"Varje morgon vaknar jag upp som en ny möjlighet.",
"Jag väljer glädje, kärlek och frihet varje dag.",
"Jag är välsignad att leva ett rikt och meningsfullt liv.",
"Mitt hjärta är fyllt med tacksamhet och kärlek.",
"Jag väljer att leva med öppenhet och nyfikenhet.",
"Jag är på en ständig resa av tillväxt och lärande.",
"Kärlek och positiva tankar skapar min verklighet.",
"Jag väljer att se skönhet och mening i varje dag.",
"Jag är fri att uttrycka mig fullt ut och autentiskt.",
"Varje ögonblick är en möjlighet att välja glädje.",
"Jag väljer att leva med passion och målmedvetenhet.",
"Jag är tacksam för alla de underbara människorna i mitt liv.",
"Mitt liv är fullt av kärlek, glädje och möjligheter.",
"Jag väljer att omfamna livet med allt vad det innebär.",
"Varje dag bär på en ny och underskön möjlighet.",
"Jag väljer att leva med tacksamhet för allt.",
"Jag är välsignad med en rik inre värld.",
"Mitt sinne är öppet för nya insikter och sanningar.",
"Jag väljer att se det bästa i mig själv och andra.",
"Kärlek och glädje är mina konstanta följeslagare.",
"Jag väljer att skapa ett liv fyllt med mening.",
"Jag är redo att välkomna allt gott som livet erbjuder.",
"Varje dag är jag tacksam för de enkla glädjerna i livet.",
"Jag väljer att leva med mod och övertygelse.",
"Mitt hjärta och mitt sinne är öppna och mottagliga.",
"Jag väljer att se livet som en fantastisk resa.",
"Jag är kapabel att förverkliga alla mina djupaste önskningar.",
"Kärlek och välmående manifesteras i mitt liv varje dag.",
"Jag väljer att leva med glädje och tacksamhet.",
"Jag är välsignad med styrka, visdom och kärlek.",
"Varje utmaning bär på en värdefull lärdom.",
"Jag väljer att omfamna varje nytt ögonblick.",
"Mitt liv är ett vackert uttryck av kärlek och tillväxt.",
"Jag väljer att leva fullt ut och autentiskt.",
"Jag är tacksam för min resa och allt den har lärt mig.",
"Kärlek är det fundament på vilket jag bygger mitt liv.",
"Jag väljer att se varje dag som en möjlighet till lycka.",
"Varje dag ger mig styrka att gå mot mina mål.",
"Jag väljer att leva med medkänsla och omtanke.",
"Jag är välsignad med ett rikt och meningsfullt liv.",
"Mitt hjärta är öppet för allt gott i livet.",
"Jag väljer att se möjligheten i varje utmaning.",
"Kärlek och positivitet strömmar in och ut ur mitt liv.",
"Jag väljer att leva med tydlighet och fokus.",
"Jag är tacksam för alla de under som omger mig.",
"Mitt liv är ett konstant flöde av välsignelser.",
"Jag är fri att leva ett liv fyllt med mening och glädje.",
"Varje nytt ögonblick är en möjlighet till förnyelse.",
"Jag väljer att leva med hopp och förväntan.",
"Jag är välsignad att vara en del av detta underbara liv.",
"Mitt sinne och hjärta är i perfekt balans och harmoni.",
"Jag väljer att se varje dag som en gåva.",
"Kärlek, glädje och fred är min naturliga tillvaro.",
"Jag väljer att leva med äkthet och djup.",
"Jag är tacksam för varje dag som en del av min resa.",
"Mitt liv är rikt på kärlek, mening och skönhet.",
"Varje dag bär jag med mig glädje och hopp.",
"Jag väljer att leva med integritet och ärlighet.",
"Jag är välsignad med oändlig kreativitet och inspiration.",
"Mitt hjärta är ett hem för kärlek och tacksamhet.",
"Jag väljer att se det vackra i varje ögonblick.",
"Jag är kapabel att nå allt jag önskar i livet.",
"Kärlek och harmoni råder i mitt liv och mina relationer.",
"Jag väljer att leva med en djup känsla av mening.",
"Jag är tacksam för det rika livet jag lever.",
"Varje dag är ett steg mot mitt bästa jag.",
"Jag väljer att se möjligheter där andra ser svårigheter.",
"Mitt liv blomstrar på alla sätt och vis.",
"Jag väljer att ge och ta emot kärlek med öppna armar.",
"Jag är välsignad med en stark och fri ande.",
"Kärlek och tacksamhet fyller varje dag i mitt liv.",
"Jag väljer att leva med glädje och entusiasm.",
"Varje dag är jag ett med min djupaste sanning.",
"Jag väljer att leva med syfte och passion.",
"Jag är tacksam för livet och allt det erbjuder mig.",
"Mitt hjärta och mitt sinne är öppna och receptiva.",
"Jag väljer att omfamna varje dag med glädje.",
"Kärlek och positivitet är mitt ständiga val.",
"Jag väljer att se varje dag som ett under.",
"Jag är välsignad med ett liv fullt av mening och kärlek.",
"Varje ögonblick är ett tillfälle att välja kärlek.",
"Jag väljer att leva med djup tacksamhet och glädje.",
"Mitt liv är en manifestation av kärlek och ljus.",
"Jag väljer att vara ett positivt ljus för alla jag möter.",
"Jag är tacksam för denna dag och alla dess gåvor."
];

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AffirmationsBoosten körs på port ${PORT}`));
