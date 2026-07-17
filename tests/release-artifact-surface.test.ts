import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test(
  'generateProvenance produces valid provenance data',
  async () => {
    const { generateProvenance, getGitCommit } = await import('../sniper/release-provenance.js');

    const currentCommit = getGitCommit();

    const provenance = await generateProvenance(
      process.cwd(),
      'manifest_hash_abc123',
      { 'test-artifact.tar.gz': 'sha256_of_artifact' }
    );

    assert.equal(provenance.version, 1);
    assert.equal(provenance.gitCommit, currentCommit);
    assert.equal(provenance.manifestSha256, 'manifest_hash_abc123');
    assert.ok(provenance.sourceTreeSha256);
    assert.ok(provenance.buildTimestamp);
    assert.equal(provenance.verifiedActionsPinned, true);
    assert.equal(provenance.releaseGatesPassed, true);
  }
);

test(
  'writeProvenance and verifyProvenance roundtrip',
  async () => {
    const { generateProvenance, writeProvenance, verifyProvenance } = await import('../sniper/release-provenance.js');

    const dir = await mkdtemp(join(tmpdir(), 'provenance-test-'));

    try {
      const provenance = await generateProvenance(
        process.cwd(),
        'manifest_hash_roundtrip',
        { 'artifact.zip': 'checksum123' }
      );

      const filePath = await writeProvenance(dir, provenance);
      assert.ok(filePath.endsWith('release-provenance.json'));

      const result = await verifyProvenance(filePath);
      assert.equal(result.valid, true);
      assert.equal(result.issues.length, 0);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }
);

test(
  'verifyProvenance detects commit mismatch',
  async () => {
    const { writeProvenance, verifyProvenance, generateProvenance } = await import('../sniper/release-provenance.js');

    const dir = await mkdtemp(join(tmpdir(), 'provenance-mismatch-'));

    try {
      const provenance = await generateProvenance(
        process.cwd(),
        'manifest_mismatch',
        {}
      );

      // Tamper with the commit
      provenance.gitCommit = 'deadbeef1234567890abcdef1234567890abcdef12';

      await writeProvenance(dir, provenance);

      const result = await verifyProvenance(join(dir, 'release-provenance.json'));
      assert.equal(result.valid, false);
      assert.ok(result.issues.some(i => i.includes('does not match')));
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }
);

test(
  'provenance includes artifact checksums',
  async () => {
    const { generateProvenance } = await import('../sniper/release-provenance.js');

    const provenance = await generateProvenance(
      process.cwd(),
      'manifest_checksums',
      {
        'sniper-bundle.tar.gz': 'abc123',
        'release-manifest.json': 'def456',
      }
    );

    assert.equal(provenance.artifactChecksums['sniper-bundle.tar.gz'], 'abc123');
    assert.equal(provenance.artifactChecksums['release-manifest.json'], 'def456');
  }
);