import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import teams from './routes/teams';
import templates from './routes/templates';
import documents from './routes/documents';
import signatures from './routes/signatures';
import users from './routes/users';
import journal from './routes/journal';
import leave from './routes/leave';
import departmentsRoute from './routes/departments';
import org from './routes/org';
import alimtalkRoute from './routes/alimtalk';
import minutes from './routes/minutes';
import commissions from './routes/commissions';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors());

// Global error handler - always return JSON
app.onError((err, c) => {
  console.error('API Error:', err.message, err.stack);
  return c.json({ error: err.message || '서버 오류가 발생했습니다.' }, 500);
});

// API Routes
app.route('/api/auth', auth);
app.route('/api/teams', teams);
app.route('/api/templates', templates);
app.route('/api/documents', documents);
app.route('/api/signatures', signatures);
app.route('/api/users', users);
app.route('/api/journal', journal);
app.route('/api/leave', leave);
app.route('/api/departments', departmentsRoute);
app.route('/api/org', org);
app.route('/api/alimtalk', alimtalkRoute);
app.route('/api/minutes', minutes);
app.route('/api/commissions', commissions);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

export default app;
