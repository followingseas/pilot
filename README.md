# Pilot

**Pilot은 rutter — 조직·팀·개인의 규약과 지식을 담는 번들 포맷 — 를 AI 코딩 에이전트에 CLI와 stdio MCP로 전달하는 도구다.**

rutter는 특정 조직에 종속된 개념이 아니다. `rutter.yaml` 매니페스트 하나로 규약 문서, 커밋·리뷰 컨벤션, 아키텍처 지도 등을 정의하는 번들 포맷이며, 누구나 자신의 조직·팀·개인용 rutter를 만들어 Pilot으로 연결할 수 있다.

## Why

AI 에이전트가 프로젝트 규약을 지키려면 그 규약이 프로젝트 어딘가에 있어야 한다. 하지만 조직 공통 규약을 프로젝트마다 복사해 두면 금방 어긋나고, 그렇다고 매번 외부 문서를 찾아 붙여 넣게 하면 경로 제약(에이전트가 프로젝트 트리 밖 파일을 못 읽는 환경)에 걸린다.

Pilot은 두 가지로 이 문제를 푼다.

- **경로 제약 없는 컨텍스트 제공**: 연결된 rutter들을 프로젝트 안(`.pilot/context.md`)으로 합성해 내려놓는다. 에이전트가 프로젝트 트리 밖을 볼 수 없어도 규약을 읽을 수 있다.
- **eager 스텁 + MCP 이중 전달**: `pilot init`이 즉시 스텁 파일(`.pilot/context.md`, `CLAUDE.md`/`AGENTS.md`)을 생성해 항상 최신 컨텍스트가 눈에 보이게 하고, 동시에 stdio MCP 서버로 `pilot_search_knowledge` 같은 정밀 검색 도구를 제공한다. 정적 스텁으로 기본 컨텍스트를, MCP로 필요할 때의 깊은 탐색을 함께 준다.

## 설치

```bash
npm install -g @followingseas/pilot   # 곧 제공 — 현재는 소스 설치를 사용
```

### 소스에서 설치

```bash
git clone https://github.com/followingseas/pilot.git
cd pilot
npm install
npm run build
npm link   # 전역 pilot 명령으로 연결
```

| 요구 사항 | 내용 |
|------|------|
| Node.js | 20 이상 |
| Git | source 연결·동기화(`pilot connect`, `pilot sync`)에 필요 |

## 빠른 시작

조직 rutter가 `https://github.com/acme/rutter.git`에 있다고 가정한다.

```bash
cd my-project                                              # 대상 프로젝트 루트(git repo)
pilot init --source https://github.com/acme/rutter.git --yes
```

`.rutter.yaml`(source 선언)과 `.pilot/context.md`(합성 컨텍스트), `CLAUDE.md`/`AGENTS.md`(참조 블록)가 생성된다.

```bash
pilot context            # 현재 프로젝트에 적용되는 항목과 provenance 확인
pilot search "커밋 메시지"  # 합성된 문서 전문 검색
```

### MCP 설정

에이전트가 `pilot mcp`를 stdio로 실행하도록 등록한다.

```json
{
  "mcpServers": {
    "pilot": {
      "command": "pilot",
      "args": ["mcp"]
    }
  }
}
```

## CLI 명령

| 명령 | 설명 |
|------|------|
| `pilot init [--source <url\|path>] [--yes]` | 프로젝트 온보딩 — `.rutter.yaml` 선언 생성/승인, 스텁 갱신을 한 번에 수행 |
| `pilot connect <location> --id <id> [--priority <n>]` | rutter source를 전역 설정에 직접 연결 (로컬 경로 또는 git URL) |
| `pilot sync [id]` | git source를 최신 커밋으로 갱신 (생략 시 전체 git source) |
| `pilot status` | 연결된 source 목록과 마지막 동기화 시각 |
| `pilot doctor` | source 로드 실패, 캐시 TTL 초과, 섀도잉 경고, 충돌, 스텁 누락을 진단 |
| `pilot context [--cwd <path>] [--json]` | 현재 프로젝트에 적용되는 합성 결과와 provenance 출력 |
| `pilot search <query> [--limit <n>] [--json]` | 합성된 문서 전문 검색 |
| `pilot mcp` | stdio MCP 서버 실행 |

모든 조회 명령은 `--json` 옵션으로 기계 판독 가능한 출력을 지원한다.

## MCP 도구

| 도구 | 설명 |
|------|------|
| `pilot_get_context` | 현재 프로젝트에 적용되는 규약·문서를 provenance와 함께 반환 |
| `pilot_search_knowledge` | 연결된 rutter의 문서를 검색 |
| `pilot_list_sources` | 연결된 rutter source 목록과 동기화 시각 |
| `pilot_doctor` | source 상태와 합성 경고를 진단 |

## rutter.yaml 스펙

rutter는 루트에 `rutter.yaml` 매니페스트를 두는 디렉토리(로컬 경로 또는 git 저장소)다.

| 필드 | 필수 | 설명 |
|------|------|------|
| `version` | O | 현재 `1` 고정 |
| `name` | O | 사람이 읽는 rutter 이름 — 스텁 문구·CLAUDE.md 참조에 쓰인다 |
| `scope` | O | `organization` · `repository` · `project-local` · `personal` 중 하나 — 섀도잉 강도를 결정 |
| `paths.conventions` | X | 규약 문서 디렉토리 (rutter 루트 기준 상대경로) |
| `paths.charts` | X | 지도·아키텍처 문서 디렉토리 |
| `paths.wiki` | X | 추가로 수집할 디렉토리 목록 |
| `repositories` | X | `{ id, remote }` 목록 — 프로젝트를 git remote로 식별해 매칭하는 데 사용 |
| `priority` | X | 기본 `0`. 같은 scope에서 섀도잉 우선순위를 정하는 정수 |

`paths`를 모두 생략하면 rutter 루트 전체(`rutter.yaml` 제외)를 수집 대상으로 삼는다. 수집 대상 파일은 `.md` · `.yaml`/`.yml` · `.json` · `.txt` 중 512KB 이하인 것만이며, `.git` · `node_modules` · `.pilot`은 항상 제외한다.

```yaml
version: 1
name: Acme Engineering Handbook
scope: organization
paths:
  conventions: conventions
  charts: charts
repositories:
  - id: payment-api
    remote: git@github.com:acme/payment-api.git
priority: 0
```

## .rutter.yaml 선언과 승인 모델

프로젝트 루트의 `.rutter.yaml`은 "이 프로젝트가 어떤 rutter를 쓰는지"에 대한 선언이다. `pilot init --source <location>`이 처음 생성하며, git으로 커밋해 팀원과 공유하는 파일이다.

```yaml
source: https://github.com/acme/rutter.git
```

선언은 **자동으로 연결되지 않는다.** 각 사용자 환경(로컬 설정, `~/.config/pilot`)에서 그 source를 승인한 이력이 없으면 `pilot init`이 연결 여부를 먼저 확인한다(`--yes`로 프롬프트 생략 가능). 팀원이 프로젝트를 clone한 뒤 `pilot init`을 실행하면, 자신의 환경에서 최초 1회만 승인하면 되고 이후로는 별도 조치 없이 같은 컨텍스트가 재현된다. 이 승인 이력은 선언 파일이 아니라 사용자 로컬 설정에 남으므로, 프로젝트를 공유한다고 해서 다른 사람의 환경이 임의로 외부 source에 연결되는 일은 없다.

## scope 합성과 섀도잉

여러 rutter가 동시에 연결되면 같은 키(상대 경로)의 문서가 겹칠 수 있다. Pilot은 scope 강도 순으로 합성해 더 좁은 범위의 문서가 더 넓은 범위의 문서를 가리게(shadow) 한다.

```
project-local > repository > organization > personal   (강함 → 약함)
```

- 같은 scope 안에서는 `priority` 값이 큰 쪽이 이긴다.
- scope와 priority가 완전히 같은 두 source가 같은 키를 가지면 합성을 중단하고 오류를 낸다 — 임의로 하나를 고르지 않고 `priority`를 명시하도록 요구한다.
- 가려진 항목은 사라지지 않고 `pilot context`의 provenance(`shadows`)에 남아 어떤 source가 어떤 source를 가렸는지 추적할 수 있다.
- 프로젝트 루트의 `.rutter/` 디렉토리는 `project-local` scope로 자동 인식된다 — 별도 연결 절차 없이 가장 강하게 적용되는, 저장소에 커밋하는 로컬 오버라이드다.

## 보안 원칙

- **읽기 전용**: Pilot은 연결된 rutter source의 파일을 읽기만 한다. source 디렉토리에 쓰거나 커밋하지 않는다.
- **경로 가드**: 합성 대상 파일은 항상 source 루트 안으로 강제된다(symlink·`..` 경유 탈출 포함). 벗어난 항목은 전체 합성을 중단시키지 않고 해당 항목만 건너뛰며 경고를 남긴다.
- **credential 마스킹**: git clone/fetch 실패 시 오류 메시지에 담긴 자격증명 포함 URL은 출력 전에 마스킹한다.
- **자동 커밋 없음**: Pilot은 프로젝트에 `.rutter.yaml` · `.pilot/context.md` · `CLAUDE.md`/`AGENTS.md`만 쓰며, git add·commit·push는 어떤 명령에서도 수행하지 않는다. 커밋 시점은 항상 사용자가 결정한다.
- **선언 자동 연결 없음**: 위 [승인 모델](#rutteryaml-선언과-승인-모델) 참고 — 프로젝트가 어떤 source를 선언했다는 사실만으로 로컬 환경이 그 source에 연결되지는 않는다.

## 레퍼런스 rutter 인스턴스

Pilot이 실제로 어떤 rutter를 읽고 합성하는지 보려면 [followingseas/rutter](https://github.com/followingseas/rutter)를 참고한다. 조직 전용 저장소는 아니며, rutter 포맷을 실제 규모로 사용하는 예시 인스턴스다.

## 개발

```bash
npm run typecheck   # 타입 검사
npm test            # vitest
npm run build       # tsup 프로덕션 빌드
```

커밋 메시지는 [Conventional Commits](https://www.conventionalcommits.org/ko/v1.0.0/)를 따른다.

## 라이선스

[MIT](LICENSE) © [Followingseas](https://github.com/followingseas)
