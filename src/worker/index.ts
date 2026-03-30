import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import teams from './routes/teams';
import templates from './routes/templates';
import documents from './routes/documents';
import signatures from './routes/signatures';
import users from './routes/users';
import journal from './routes/journal';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());

// API Routes
app.route('/api/auth', auth);
app.route('/api/teams', teams);
app.route('/api/templates', templates);
app.route('/api/documents', documents);
app.route('/api/signatures', signatures);
app.route('/api/users', users);
app.route('/api/journal', journal);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

export default app;
