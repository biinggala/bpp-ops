import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesPerson, mergePeople, personLabel, searchPeople } from '../.test-build/lib/people.js'

test('이름·별명·주소 어느 것으로도 찾힙니다', () => {
  const p = { email: 'hg@bpp.co.kr', name: '김희건', nickname: '건' }
  assert.equal(matchesPerson(p, '희건'), true)
  assert.equal(matchesPerson(p, '건'), true)
  assert.equal(matchesPerson(p, 'HG@'), true)
  assert.equal(matchesPerson(p, '철수'), false)
  assert.equal(matchesPerson(p, '  '), false)
})

test('별명은 이름 뒤에 붙고, 이름이 없으면 주소 앞부분입니다', () => {
  assert.equal(personLabel({ email: 'hg@bpp.co.kr', name: '김희건', nickname: '건' }), '김희건 (건)')
  assert.equal(personLabel({ email: 'hg@bpp.co.kr', name: '김희건' }), '김희건')
  assert.equal(personLabel({ email: 'hg@bpp.co.kr' }), 'hg')
})

test('두 출처의 같은 사람은 한 줄이고, 빈 칸만 채워집니다', () => {
  const merged = mergePeople(
    [{ email: 'A@bpp.co.kr', name: '프로필 이름' }],
    [{ email: 'a@bpp.co.kr', name: '명단 이름', nickname: '에이' }, { email: 'b@bpp.co.kr', name: '비' }],
  )
  assert.deepEqual(merged, [
    { email: 'a@bpp.co.kr', name: '프로필 이름', nickname: '에이' },
    { email: 'b@bpp.co.kr', name: '비', nickname: undefined },
  ])
})

test('이미 있는 사람은 검색에서 빠집니다', () => {
  const people = [{ email: 'a@bpp.co.kr', name: '가' }, { email: 'b@bpp.co.kr', name: '가나' }]
  assert.deepEqual(searchPeople(people, '가', ['A@bpp.co.kr']).map(p => p.email), ['b@bpp.co.kr'])
})
