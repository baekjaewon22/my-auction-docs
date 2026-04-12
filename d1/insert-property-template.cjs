// Node script to insert template via wrangler
const fs = require('fs');
const { execSync } = require('child_process');

const html = fs.readFileSync(__dirname + '/property-report-content.html', 'utf8');
// Escape single quotes for SQL
const escaped = html.replace(/'/g, "''");

const sql = `INSERT OR REPLACE INTO templates (id, title, description, content, category, created_by, is_active) VALUES ('tpl-work-008', '물건분석보고서', '경매 물건 권리분석 및 컨설팅 계약 보고서 (A4 2페이지)', '${escaped}', '업무/보고', 'admin-001', 1);`;

// Write to temp file
fs.writeFileSync(__dirname + '/temp-insert.sql', sql);

// Execute on remote
try {
  const result = execSync(`npx wrangler d1 execute auction-docs-db --remote --file="${__dirname}/temp-insert.sql"`, { encoding: 'utf8', timeout: 30000 });
  console.log('Remote:', result);
} catch (e) {
  console.error('Remote error:', e.message);
}

// Execute on local
try {
  const result = execSync(`npx wrangler d1 execute auction-docs-db --local --file="${__dirname}/temp-insert.sql"`, { encoding: 'utf8', timeout: 30000 });
  console.log('Local:', result);
} catch (e) {
  console.error('Local error:', e.message);
}

// Cleanup
fs.unlinkSync(__dirname + '/temp-insert.sql');
console.log('Done');
