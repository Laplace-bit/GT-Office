const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const scriptPath = path.join(__dirname, '..', 'run-tauri-with-env.cjs')
const {
  hasTauriSigningKeyComment,
  summarizeSigningPreflightFailure,
  readNonEmptyEnv,
  resolveBuildConfigOverride,
} = require(scriptPath)

test('readNonEmptyEnv trims populated values and ignores blanks', () => {
  assert.equal(readNonEmptyEnv({ KEY: '  value  ' }, 'KEY'), 'value')
  assert.equal(readNonEmptyEnv({ KEY: '   ' }, 'KEY'), null)
  assert.equal(readNonEmptyEnv({}, 'KEY'), null)
})

test('hasTauriSigningKeyComment detects minisign secret key payloads', () => {
  assert.equal(hasTauriSigningKeyComment('untrusted comment: minisign secret key\nRWRTY0Iy...'), true)
  assert.equal(hasTauriSigningKeyComment('RWRTY0Iy...'), false)
  assert.equal(hasTauriSigningKeyComment(''), false)
})

test('resolveBuildConfigOverride keeps updater disabled when signing is not enabled', () => {
  assert.deepEqual(resolveBuildConfigOverride({ GTO_UPDATER_PUBKEY: 'pubkey-value' }), {
    plugins: {
      updater: {
        pubkey: 'pubkey-value',
      },
    },
  })
})

test('resolveBuildConfigOverride enables updater artifacts only for valid signing configuration', () => {
  assert.deepEqual(
    resolveBuildConfigOverride(
      {
        GTO_ENABLE_UPDATER_ARTIFACTS: '1',
        GTO_UPDATER_PUBKEY: 'pubkey-value',
        TAURI_SIGNING_PRIVATE_KEY: 'untrusted comment: minisign secret key\nRWRTY0Iy...',
      },
      { isUpdaterArtifactSigningReady: () => true },
    ),
    {
      bundle: {
        createUpdaterArtifacts: true,
      },
      plugins: {
        updater: {
          pubkey: 'pubkey-value',
        },
      },
    },
  )
})

test('resolveBuildConfigOverride skips updater artifacts for malformed signing keys', () => {
  assert.deepEqual(
    resolveBuildConfigOverride(
      {
        GTO_ENABLE_UPDATER_ARTIFACTS: '1',
        GTO_UPDATER_PUBKEY: 'pubkey-value',
        TAURI_SIGNING_PRIVATE_KEY: 'not-a-valid-secret-key',
      },
      { isUpdaterArtifactSigningReady: () => true },
    ),
    {
      plugins: {
        updater: {
          pubkey: 'pubkey-value',
        },
      },
    },
  )
})

test('resolveBuildConfigOverride skips updater artifacts when signing preflight fails', () => {
  assert.deepEqual(
    resolveBuildConfigOverride(
      {
        GTO_ENABLE_UPDATER_ARTIFACTS: '1',
        GTO_UPDATER_PUBKEY: 'pubkey-value',
        TAURI_SIGNING_PRIVATE_KEY: 'untrusted comment: minisign secret key\nRWRTY0Iy...',
      },
      { isUpdaterArtifactSigningReady: () => false },
    ),
    {
      plugins: {
        updater: {
          pubkey: 'pubkey-value',
        },
      },
    },
  )
})

test('summarizeSigningPreflightFailure reports wrong updater private key passwords clearly', () => {
  assert.equal(
    summarizeSigningPreflightFailure(
      'failed to decode secret key: incorrect updater private key password: Wrong password for that key',
    ),
    'TAURI_SIGNING_PRIVATE_KEY_PASSWORD could not unlock TAURI_SIGNING_PRIVATE_KEY',
  )
})
