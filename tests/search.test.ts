import { describe, it, expect } from 'vitest'
import { searchDocs } from '../src/core/search.js'
import type { SynthesisResult } from '../src/core/synthesize.js'

const synthesis: SynthesisResult = {
  warnings: [],
  items: [
    { key: 'conventions/commit.md', sourceId: 'org', scope: 'organization', filePath: '/x/commit.md',
      content: '# 커밋 컨벤션\nConventional Commits를 따른다. BREAKING CHANGE는 대문자.', shadows: [] },
    { key: 'charts/projects.md', sourceId: 'org', scope: 'organization', filePath: '/x/projects.md',
      content: '# 프로젝트 지도\nwake는 세션 뷰어다.', shadows: [] }
  ]
}

describe('searchDocs', () => {
  it('본문 키워드로 해당 문서를 찾고 snippet을 준다', () => {
    const hits = searchDocs(synthesis, 'BREAKING CHANGE')
    expect(hits[0]?.key).toBe('conventions/commit.md')
    expect(hits[0]?.snippet).toContain('BREAKING')
  })
  it('제목 매칭이 동작한다', () => {
    expect(searchDocs(synthesis, '프로젝트 지도')[0]?.key).toBe('charts/projects.md')
  })
  it('무관한 질의는 빈 결과', () => {
    expect(searchDocs(synthesis, 'kubernetes helm')).toHaveLength(0)
  })
})
