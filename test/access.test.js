import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorizedEmails, canAccessProject } from '../.test-build/lib/utils.js'

// These guard the two places that decide who a user is allowed to see: the
// stats view and the member-invite autocomplete. Both draw from data that
// covers the whole workspace — userProfiles holds every account that has ever
// signed in — so the scoping is what keeps them from listing strangers.

const ME = 'me@bpp.co.kr'
const projects = [
  { id: 'p1', name: 'Mine', color: '#000', memberEmails: [ME, 'teammate@bpp.co.kr'] },
  { id: 'p2', name: 'Theirs', color: '#000', memberEmails: ['stranger@example.com'] },
  { id: 'p3', name: 'Created', color: '#000', creatorEmail: ME, memberEmails: ['helper@bpp.co.kr'] },
  { id: 'p4', name: 'No owner', color: '#000' },
]

test('suggestable people are limited to those sharing a project with the user', () => {
  const allowed = authorizedEmails(projects, ME)

  assert.equal(allowed.has('teammate@bpp.co.kr'), true)
  assert.equal(allowed.has('helper@bpp.co.kr'), true)
  assert.equal(allowed.has(ME), true)

  // The whole point: someone whose only project the user has no part in must
  // never be offered, even though their profile is readable.
  assert.equal(allowed.has('stranger@example.com'), false)
})

test('a project carrying no ownership data grants nobody', () => {
  assert.equal(canAccessProject({ id: 'p4', name: 'No owner', color: '#000' }, ME), false)
  // ...and contributes no one to the suggestion pool.
  const allowed = authorizedEmails([{ id: 'p4', name: 'No owner', color: '#000' }], ME)
  assert.deepEqual([...allowed], [ME])
})

test('a signed-out user can see nobody', () => {
  assert.equal(authorizedEmails(projects, null).size, 0)
  assert.equal(authorizedEmails(projects, undefined).size, 0)
})

test('membership matching ignores address casing', () => {
  const shouty = [{ id: 'p5', name: 'Shouty', color: '#000', memberEmails: ['ME@BPP.CO.KR', 'Team@Bpp.Co.Kr'] }]
  const allowed = authorizedEmails(shouty, ME)
  assert.equal(allowed.has('team@bpp.co.kr'), true)
})
