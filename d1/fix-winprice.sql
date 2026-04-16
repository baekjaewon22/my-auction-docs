UPDATE journal_entries SET data = json_set(data, '$.winPrice', json_extract(data, '$.bidPrice'))
WHERE id = 'd9d00431-c543-417c-a41c-be3ead850acb';

UPDATE journal_entries SET data = json_set(data, '$.winPrice', json_extract(data, '$.bidPrice'))
WHERE id = '98ce12f2-63af-4e25-9a1e-5034da97ab3f';

UPDATE journal_entries SET data = json_set(data, '$.winPrice', json_extract(data, '$.bidPrice'))
WHERE id = 'cc28a938-8fca-4f56-9a24-2c73aff61623';
