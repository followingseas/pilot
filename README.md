# Pilot

**Pilot은 rutter — 규약·지식·정책을 담는 패키지 — 를 AI 코딩 에이전트에 적용하는 런타임이다.** rutter 패키지를 프로젝트에 설치하면 조직 규약이 에이전트가 읽는 파일(`CLAUDE.md`·`AGENTS.md` 등)과 MCP 도구로 내려온다.

npm에 빗대면 이렇다: **pilot = npm(CLI)**, **rutter = 패키지**, **`rutter.yaml` = `package.json`**, **`.pilot/rutter.lock` = `package-lock.json`**. rutter는 특정 조직 전용이 아니라, 누구나 자신의 조직·팀·개인용으로 만들어 pilot으로 적용하는 포맷이다.

## Why

AI 에이전트가 프로젝트 규약을 지키려면 그 규약이 프로젝트 어딘가에 있어야 한다. 하지만 조직 공통 규약을 프로젝트마다 복사해 두면 금방 어긋나고, 그렇다고 매번 외부 문서를 찾아 붙여 넣게 하면 경로 제약(에이전트가 프로젝트 트리 밖 파일을 못 읽는 환경)에 걸린다.

Pilot은 두 가지로 이 문제를 푼다.

- **경로 제약 없는 컨텍스트 제공**: 적용된 rutter를 프로젝트 안(`.pilot/context.md`·`CLAUDE.md`·`AGENTS.md`)으로 합성해 내려놓는다. 에이전트가 프로젝트 트리 밖을 볼 수 없어도 규약을 읽을 수 있다.
- **정적 파일 + MCP 이중 전달**: `pilot apply`가 항상 최신 컨텍스트를 파일로 내려놓아 눈에 보이게 하고, 동시에 stdio MCP 서버로 `pilot_get_policy`·`pilot_search_knowledge` 같은 질의 도구를 제공한다. 정적 파일로 기본 컨텍스트를, MCP로 필요할 때의 깊은 탐색을 함께 준다.

Pilot 자체에는 AI·모델이 들어 있지 않다. 에이전트가 알아듣는 프로토콜(MCP)로 rutter 데이터를 넘겨주는 **에이전트 인프라**이며, 판단은 에이전트 쪽에 있다 (언어 서버가 에디터에 데이터를 서빙하는 관계와 같다).

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

`init`은 `.rutter.yaml`(source 선언)을 만들어 연결하고, 곧바로 `apply`를 실행해 다음을 생성한다: `.pilot/context.md`(합성 컨텍스트), `CLAUDE.md`·`AGENTS.md`(규약 블록), `.pilot/rutter.lock`·`.pilot/release.yaml`(재현성·설치 상태). 어댑터가 활성이면 `.github/copilot-instructions.md`도.

```bash
pilot apply              # rutter가 바뀌면 다시 적용 (revision 증가, 내용 안 바뀌면 파일 churn 없음)
pilot diff               # 적용 전 산출물 미리보기 (파일 안 씀)
pilot context            # 현재 적용되는 항목과 provenance 확인
pilot search "커밋 메시지"  # 합성된 문서 전문 검색
```

### MCP 설정

에이전트가 `pilot mcp`를 stdio로 실행하도록 등록한다.

```json
{
  "mcpServers": {
    "pilot": { "command": "pilot", "args": ["mcp"] }
  }
}
```

## CLI 명령

| 명령 | 설명 |
|------|------|
| `pilot init [--source <url\|path>] [--yes]` | 프로젝트 온보딩 — `.rutter.yaml` 선언 생성/승인 후 `apply` 실행 |
| `pilot apply [--values <f>] [--set k=v] [--approve-locked-field-change]` | rutter를 적용 — values 병합 → 렌더 → `.pilot/rutter.lock`·`.pilot/release.yaml` 기록 (설치/갱신 겸용, 멱등, revision 증가) |
| `pilot diff [--values <f>] [--set k=v]` | dry-run 렌더 — 파일을 쓰지 않고 산출물 출력 |
| `pilot rollback --to-revision <n>` | 해당 revision의 산출물·lock 복원 (새 revision으로 기록) |
| `pilot history` | revision 목록 |
| `pilot connect <location> --id <id> [--priority <n>]` | rutter source를 전역 설정에 직접 연결 (로컬 경로 또는 git URL) |
| `pilot sync [id]` | git source를 최신 커밋으로 갱신 (생략 시 전체 git source) |
| `pilot status` | 연결된 source 목록과 마지막 동기화 시각 |
| `pilot doctor [--cwd <path>] [--json]` | source 로드 실패, 캐시 TTL 초과, 섀도잉 경고, 충돌을 진단 |
| `pilot context [--cwd <path>] [--json]` | 현재 프로젝트에 적용되는 합성 결과와 provenance 출력 |
| `pilot search <query> [--limit <n>] [--json]` | 합성된 문서 전문 검색 |
| `pilot package lint [dir]` | 패키지 구조·values·PolicySet 검사 (authoring용) |
| `pilot mcp` | stdio MCP 서버 실행 |

`--values`와 `--set`은 반복 지정할 수 있으며, 병합 강도는 `dependency defaults < 패키지 defaults < --values 파일(지정 순) < --set` 순이다. connect·sync·status·doctor·context·search는 `--json`을 지원한다.

## MCP 도구

| 도구 | 설명 |
|------|------|
| `pilot_get_context` | 현재 프로젝트에 적용되는 규약·문서를 provenance와 함께 반환 |
| `pilot_get_policy` | 지정 agent(claude/codex/copilot/generic)에 적용되는 PolicySet rule을 전체 계약(examples·checks·remediation 포함)으로 반환 |
| `pilot_search_knowledge` | 적용된 rutter의 문서를 검색 |
| `pilot_list_sources` | 연결된 rutter source 목록과 동기화 시각 |
| `pilot_resolve_release` | 적용된 release·lock 해석 결과(revision, source digest, locked field) — 고정 스키마 JSON |
| `pilot_doctor` | source 상태와 합성 경고를 진단 |

## rutter.yaml

rutter는 루트에 `rutter.yaml` 매니페스트를 두는 디렉토리(로컬 경로 또는 git 저장소)다. 매니페스트는 `package.json`처럼 평면 구조다.

```yaml
name: acme-core
version: 2.0.0
scope: organization          # organization | repository | project-local | personal
type: application            # application | library(단독 적용 불가, dependency 전용) | overlay

docs:
  conventions: docs/conventions   # 규약 문서 디렉토리
  maps: docs/maps                 # 지도·아키텍처 문서 디렉토리
  # wiki: [ ... ]                 # 추가 수집 디렉토리
policies: policies                # PolicySet YAML 디렉토리
defaults: defaults.yaml           # 패키지 기본 values

adapters:                         # 렌더 대상 (생략 시 claude·codex 활성, copilot 비활성)
  claude:  { enabled: true }      # → CLAUDE.md
  codex:   { enabled: true }      # → AGENTS.md
  copilot: { enabled: true }      # → .github/copilot-instructions.md

dependencies:                     # 다른 rutter를 상속 (1단계, api형 전이)
  - name: shared-git
    version: 1.4.0                 # 정확한 버전 (semver range 해석은 아직 미지원 — 불일치 시 경고만)
    repository: https://github.com/acme/rutter-git

repositories:                     # git remote로 프로젝트를 식별해 매칭
  - id: payment-api
    remote: git@github.com:acme/payment-api.git

values:                           # (선택) 병합·잠금 설정
  merge:
    overrides:
      - path: /policies/rules
        strategy: uniqueBy:id     # array 병합 전략: append | unique | uniqueBy:<field>
  lockedFields:
    - /security/signing/required  # JSON Pointer — apply에서 변경 시 명시 승인 요구

priority: 0                       # 같은 scope에서 섀도잉 우선순위
```

| 필드 | 필수 | 설명 |
|------|------|------|
| `name` | O | 패키지 이름 (release·lock에 기록) |
| `version` | X | 패키지 버전 — dependency가 이 값에 맞춰 해석된다 |
| `scope` | O | 섀도잉 강도 (아래 [scope 합성](#scope-합성과-섀도잉)) |
| `type` | X | 기본 `application`. `library`는 단독 적용 불가, dependency로만 사용 |
| `docs.conventions` / `docs.maps` / `docs.wiki` | X | 수집할 문서 디렉토리 (루트 기준 상대경로) |
| `policies` | X | PolicySet YAML 디렉토리 |
| `defaults` | X | 패키지 기본 values 파일 |
| `adapters.claude/codex/copilot` | X | `{ enabled, output }` — `output`은 프로젝트 상대 경로만 허용 |
| `dependencies[]` | X | `{ name, version?, repository, alias? }` — 로컬 경로 또는 git URL, 1단계 해석 |
| `repositories[]` | X | `{ id, remote }` — 프로젝트 매칭용 |
| `values.merge.overrides[]` · `values.lockedFields[]` | X | array 병합 전략 · 잠금 필드(JSON Pointer) |
| `priority` | X | 기본 `0`. 같은 scope에서 섀도잉 우선순위 |

`docs`·`policies`를 모두 생략하면 rutter 루트 전체(`rutter.yaml` 제외)를 수집한다. 수집 대상은 `.md`·`.yaml`/`.yml`·`.json`·`.txt` 중 512KB 이하이며, `.git`·`node_modules`·`.pilot`은 항상 제외한다.

### PolicySet

`policies/*.yaml`은 기계 검증 가능한 규칙을 선언한다. 매니페스트와 같은 평면 구조다.

```yaml
name: org-core
appliesTo:
  agents: [claude, codex, copilot, generic]
rules:
  - id: git.branch.naming
    level: error               # error | warn | info
    statement: "브랜치는 feature/<slug> 형식을 사용한다."
    rationale: "리뷰·추적·자동화 분기를 일관되게 유지하기 위해서다."
    checks:
      - kind: regex
        target: git.branch.name
        pattern: "^feature/[a-z0-9._-]+$"
```

rule의 최소 필드는 `id`·`level`·`statement`이고, `rationale`·`examples`·`checks`·`remediation`을 함께 둘 수 있다. rule은 렌더 산출물(claude/codex `## 핵심 규칙`, copilot `## Rules`)과 MCP `pilot_get_policy` 응답에 반영된다. `checks`는 현재 렌더·질의용 데이터이며 pilot이 직접 실행하지는 않는다(강제는 commitlint·CI 등이 담당).

### 릴리스 상태 파일

| 파일 | 역할 |
|------|------|
| `.pilot/rutter.lock` | exact 해석 결과 — source digest(git HEAD sha 또는 content sha256), dependency digest, effective values digest, locked field. 커밋 대상 |
| `.pilot/release.yaml` | 적용 상태 — 이름, revision, 산출물 checksum(렌더 블록 기준 sha256), 이전 revision. 커밋 대상 |
| `.pilot/history/<rev>/` | revision별 스냅샷(release·산출물 블록·values·lock) — rollback의 복원 원본. 로컬 전용 |

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

여러 rutter를 함께 연결하는 것이 재사용의 핵심이다. 예를 들어 외부 벤더 rutter(낮은 priority)와 우리 조직 rutter(높은 priority)를 함께 연결하면, 에이전트는 벤더 기준선을 따르되 조직 규약이 충돌 지점을 덮어쓴다. 패키지가 다른 패키지를 품게 하려면 `dependencies`를 쓴다.

## 보안 원칙

- **읽기 전용**: Pilot은 연결된 rutter source의 파일을 읽기만 한다. source 디렉토리에 쓰거나 커밋하지 않는다.
- **경로 가드**: 합성·렌더 대상 경로는 항상 루트 안으로 강제된다(symlink·`..`·절대경로 탈출 차단). 매니페스트의 `adapters.output`·`policies`·`defaults`·dependency 로컬 경로도 파싱 시점에 검증한다.
- **credential 마스킹**: git URL의 자격증명은 오류·출력·lock에서 마스킹한다. URL에 자격증명을 포함한 선언은 거부한다.
- **자동 커밋 없음**: Pilot은 프로젝트에 `.rutter.yaml`·`.pilot/*`·렌더 대상 파일만 쓰며, git add·commit·push는 하지 않는다. 커밋 시점은 항상 사용자가 결정한다.
- **선언 자동 연결 없음**: 위 [승인 모델](#rutteryaml-선언과-승인-모델) 참고.

## 레퍼런스 rutter 인스턴스

Pilot이 실제로 어떤 rutter를 읽고 적용하는지 보려면 [followingseas/rutter](https://github.com/followingseas/rutter)를 참고한다. 조직 전용 저장소는 아니며, rutter 포맷을 실제 규모로 사용하는 예시 인스턴스다.

## 개발

```bash
npm run typecheck   # 타입 검사
npm test            # vitest
npm run build       # tsup 프로덕션 빌드
```

기여 절차와 커밋 규칙은 [기여 안내](https://github.com/followingseas/.github/blob/main/CONTRIBUTING.md)를 참조하십시오.

## 라이선스

[MIT](LICENSE) © [Followingseas](https://github.com/followingseas)
