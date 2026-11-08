import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateVercelButtons } from '../vercel-button-contract.mjs'
const button = env =>
  `https://vercel.com/new/clone?repository-url=https%3A%2F%2Fexample.invalid%2Frepo&env=${encodeURIComponent(env)}`
test('README without a deployment button is valid', () => {
  assert.doesNotThrow(() => validateVercelButtons('# A fork README', 'README'))
})
test('a button requesting both runtime secret names is valid', () => {
  assert.doesNotThrow(() =>
    validateVercelButtons(
      `<a href="${button('JWT_SECRET,NWC_VAULT_SECRET')}">Deploy</a>`,
      'README'
    )
  )
})
for (const env of ['JWT_SECRET', 'NWC_VAULT_SECRET', '']) {
  test(`button missing required secret names fails: ${env}`, () => {
    assert.throws(
      () => validateVercelButtons(`[Deploy](${button(env)})`, 'README'),
      /both runtime secrets/
    )
  })
}
test('every real button must comply; one valid button cannot conceal another invalid one', () => {
  const valid = button('JWT_SECRET,NWC_VAULT_SECRET')
  const invalid = button('JWT_SECRET')
  for (const links of [
    [valid, invalid],
    [invalid, valid]
  ])
    assert.throws(
      () => validateVercelButtons(links.join('\n'), 'README'),
      /both runtime secrets/
    )
})
test('secret names elsewhere or in a different URL parameter do not satisfy a button', () => {
  assert.throws(
    () =>
      validateVercelButtons(
        'env=JWT_SECRET%2CNWC_VAULT_SECRET ' + button(''),
        'README'
      ),
    /both runtime secrets/
  )
  assert.throws(
    () =>
      validateVercelButtons(
        'https://vercel.com/new/clone?description=env=JWT_SECRET%2CNWC_VAULT_SECRET',
        'README'
      ),
    /both runtime secrets/
  )
})
test('docs still require a deployment button and validate all its links', () => {
  assert.throws(
    () => validateVercelButtons('# No button', 'docs', true),
    /button/
  )
  assert.doesNotThrow(() =>
    validateVercelButtons(button('NWC_VAULT_SECRET,JWT_SECRET'), 'docs', true)
  )
})

test('ambiguous duplicate env parameters do not split the required names across buttons or parameters', () => {
  assert.throws(
    () =>
      validateVercelButtons(
        'https://vercel.com/new/clone?env=JWT_SECRET&env=NWC_VAULT_SECRET',
        'README'
      ),
    /both runtime secrets/
  )
})
test('multiple compliant buttons and HTML escaped separators remain valid', () => {
  const valid = button('JWT_SECRET,NWC_VAULT_SECRET')
  assert.doesNotThrow(() =>
    validateVercelButtons(
      valid + '\n' + valid.replaceAll('&', '&amp;'),
      'README'
    )
  )
})

test('real protocol-relative and explicit-port Vercel links cannot bypass validation', () => {
  for (const link of [
    '//vercel.com/new/clone?env=JWT_SECRET',
    'https://vercel.com:443/new/clone?env=NWC_VAULT_SECRET',
    'https://%76ercel.com/new/clone?env=JWT_SECRET'
  ])
    assert.throws(
      () => validateVercelButtons(link, 'README'),
      /both runtime secrets/
    )
})
