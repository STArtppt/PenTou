#!/usr/bin/env bash
# 把 main 上的产品代码 commit 半自动同步到 public 分支。
# 配套：src/docs/features/opensource-release/guide.md §4
#
# 用法：
#   scripts/sync-to-public.sh                          自动从最近的 sync/* tag 同步到 main HEAD
#   scripts/sync-to-public.sh --from <ref> --to <ref>  显式指定区间
#   scripts/sync-to-public.sh --dry-run                只列出待同步 commit，不切分支
#
# 必填环境变量：
#   SYNC_NOREPLY_EMAIL   GitHub noreply 邮箱（commit author）
#   SYNC_AUTHOR_NAME     开源昵称
#
# 可选环境变量：
#   PUBLIC_BRANCH        默认 public
#   SOURCE_BRANCH        默认 main

set -euo pipefail

PUBLIC_BRANCH="${PUBLIC_BRANCH:-public}"
SOURCE_BRANCH="${SOURCE_BRANCH:-main}"
NOREPLY_EMAIL="${SYNC_NOREPLY_EMAIL:-}"
AUTHOR_NAME="${SYNC_AUTHOR_NAME:-}"

# 与 .githooks/pre-commit 黑名单保持一致
BLACKLIST_PATHS=(
  CLAUDE.md AGENTS.md EXAMPLES.md
  skills rules guidelines
  .claude .waylog
  src/docs
)

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
}

FROM=""
TO="$SOURCE_BRANCH"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from) FROM="$2"; shift 2;;
    --to)   TO="$2"; shift 2;;
    --dry-run) DRY_RUN=1; shift;;
    -h|--help) usage; exit 0;;
    *) echo "未知参数: $1" >&2; usage >&2; exit 1;;
  esac
done

# 0) 仓库根
cd "$(git rev-parse --show-toplevel)"

# 1) 工作区干净
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ 工作区不干净，请先 commit / stash" >&2
  exit 1
fi

# 2) 推断 FROM
if [ -z "$FROM" ]; then
  FROM="$(git tag --list 'sync/*' --sort=-committerdate | head -1 || true)"
  if [ -z "$FROM" ]; then
    echo "❌ 仓库中没有 sync/* tag，请显式 --from <ref>" >&2
    exit 1
  fi
  echo "ℹ️  使用上次同步标签作为起点：$FROM"
fi

# 3) 列出待同步 commit
if ! git rev-parse --verify "$FROM" >/dev/null 2>&1; then
  echo "❌ ref 不存在：$FROM" >&2
  exit 1
fi
if ! git rev-parse --verify "$TO" >/dev/null 2>&1; then
  echo "❌ ref 不存在：$TO" >&2
  exit 1
fi

COMMITS="$(git log --reverse --pretty=format:'%H' "$FROM..$TO")"
if [ -z "$COMMITS" ]; then
  echo "✓ 无待同步 commit（${FROM}..${TO}）"
  exit 0
fi

echo ""
echo "待同步 commit（${FROM}..${TO}）："
git log --reverse --oneline "$FROM..$TO"
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
  echo "(dry-run 模式，不做任何修改)"
  exit 0
fi

# 4) 必填校验
if [ -z "$NOREPLY_EMAIL" ] || [ -z "$AUTHOR_NAME" ]; then
  echo "❌ 缺少环境变量 SYNC_NOREPLY_EMAIL / SYNC_AUTHOR_NAME" >&2
  echo ""
  usage >&2
  exit 1
fi

# 5) 确认
read -r -p "继续切到 $PUBLIC_BRANCH 并 cherry-pick 上面这些 commit？[y/N] " ans
case "$ans" in
  y|Y|yes|YES) ;;
  *) echo "已取消"; exit 0;;
esac

# 6) 切到 public 分支
git checkout "$PUBLIC_BRANCH"

# 7) 逐条 cherry-pick → 剔除黑名单 → 用 noreply 邮箱 commit
SUCCESS_COUNT=0
SKIPPED=()
while IFS= read -r SHA; do
  [ -z "$SHA" ] && continue
  SUBJECT="$(git log -1 --pretty=format:'%s' "$SHA")"
  echo ""
  echo "──── cherry-pick $SHA — $SUBJECT"

  if ! git cherry-pick --no-commit "$SHA"; then
    echo ""
    echo "⚠️  cherry-pick 冲突，已暂停。手动恢复步骤：" >&2
    echo "   1) 解决冲突；2) git add <files>；" >&2
    echo "   3) git -c user.email=\"$NOREPLY_EMAIL\" -c user.name=\"$AUTHOR_NAME\" commit -m \"<英文 msg>\"" >&2
    echo "   4) 重新跑：$0 --from $SHA" >&2
    exit 1
  fi

  REMOVED=()
  for p in "${BLACKLIST_PATHS[@]}"; do
    if git diff --cached --name-only | grep -qE "^$p(/|\$)"; then
      git reset HEAD -- "$p" >/dev/null 2>&1 || true
      git checkout HEAD -- "$p" 2>/dev/null || rm -rf "$p"
      REMOVED+=("$p")
    fi
  done
  if [ "${#REMOVED[@]}" -gt 0 ]; then
    echo "   剔除黑名单：${REMOVED[*]}"
  fi

  if [ -z "$(git diff --cached --name-only)" ]; then
    echo "   ⏭  剔除黑名单后无产品代码改动，跳过 commit"
    SKIPPED+=("$SHA — $SUBJECT")
    git checkout . >/dev/null 2>&1 || true
    continue
  fi

  git -c user.email="$NOREPLY_EMAIL" \
      -c user.name="$AUTHOR_NAME" \
      commit -m "$SUBJECT"
  SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
done <<EOF
$COMMITS
EOF

# 8) 收尾提示
echo ""
echo "✓ 完成 $SUCCESS_COUNT 条 cherry-pick"
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo ""
  echo "以下 commit 因仅含 AI 流程改动而跳过："
  for s in "${SKIPPED[@]}"; do echo "  - $s"; done
fi

cat <<EOF

──── 下一步（手动） ────
1) 审阅并改写 commit message（中文 → 英文风格）：
     git log --oneline ${PUBLIC_BRANCH}~${SUCCESS_COUNT}..${PUBLIC_BRANCH}
     git rebase -i ${PUBLIC_BRANCH}~${SUCCESS_COUNT}    # 把要改的标 'reword'

2) 推送双远端 + 打 sync 标签：
     TODAY=\$(date +%Y-%m-%d)
     git push origin ${PUBLIC_BRANCH}
     git push github ${PUBLIC_BRANCH}:main
     git tag sync/\$TODAY
     git push origin sync/\$TODAY
     git push github sync/\$TODAY

3) 切回 ${SOURCE_BRANCH} 继续开发：
     git checkout ${SOURCE_BRANCH}
EOF
