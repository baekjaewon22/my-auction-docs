import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  briefingMaterialMonth,
  briefingMaterialObjectKey,
  isAllowedBriefingFile,
  safeBriefingFileName,
} from '../src/worker/lib/briefing-materials.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('briefing upload accepts only presentation and PDF originals', () => {
  assert.equal(isAllowedBriefingFile('brief.pdf'), true);
  assert.equal(isAllowedBriefingFile('brief.PPTX'), true);
  assert.equal(isAllowedBriefingFile('brief.pptm'), true);
  assert.equal(isAllowedBriefingFile('brief.exe'), false);
  assert.equal(safeBriefingFileName('../2026:brief?.pdf'), '.._2026_brief_.pdf');
});

test('briefing month and R2 keys use the KST monthly partition', () => {
  const utcBeforeKstMidnight = new Date('2026-07-31T15:10:00.000Z');
  assert.equal(briefingMaterialMonth(utcBeforeKstMidnight), '2026.08');
  assert.equal(
    briefingMaterialObjectKey('2026.08', 'material-id', 'briefing.pdf'),
    'briefing-materials/2026-08/material-id/briefing.pdf',
  );
});

test('retention requires both three months of age and completed Drive backup', () => {
  const retention = source('src/worker/lib/briefing-material-retention.ts');
  assert.match(retention, /created_at < datetime\('now', '-3 months'\)/);
  assert.match(retention, /drive_status = 'success'/);
  assert.match(retention, /drive_backed_up_at IS NOT NULL/);
  assert.match(retention, /archived_at=datetime\('now'\), object_key=''/);
});

test('Drive backup stores originals in monthly, branch, and assignee folders', () => {
  const runner = source('src/worker/drive-backup-runner.ts');
  assert.match(runner, /'브리핑자료'/);
  assert.match(runner, /\$\{material\.material_month[^}]*\} 브리핑자료 모음/);
  assert.match(runner, /material\.branch/);
  assert.match(runner, /material\.assignee_name/);
  assert.match(runner, /uploadFileBuffer/);
});

test('briefing list and downloads are server-scoped and exclude archived rows', () => {
  const route = source('src/worker/routes/briefing-materials.ts');
  assert.match(route, /const scope = materialScope\(profile\)/);
  assert.match(route, /conditions = \['archived_at IS NULL'\]/);
  assert.match(route, /WHERE id = \? AND archived_at IS NULL\$\{scope\.sql\}/);
  assert.match(route, /MAX_BRIEFING_MATERIAL_BYTES/);
});

test('UI provides drag/drop submission and a document archive subcategory', () => {
  const analysis = source('src/react-app/pages/BidAnalysis.tsx');
  const notes = source('src/react-app/pages/AdminNotes.tsx');
  const archive = source('src/react-app/pages/Archive.tsx');
  assert.doesNotMatch(analysis, /briefing-material-dropzone/);
  assert.match(notes, /briefing-registration-files/);
  assert.match(notes, /accept="\.pdf,\.ppt,\.pptx,\.pptm"/);
  assert.match(notes, /api\.briefingMaterials\.upload\(file, formAssigneeId, briefingCaseNumber\)/);
  assert.match(archive, /category: 'briefing'/);
  assert.match(archive, /BriefingMaterialArchive/);
});
