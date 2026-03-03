#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$ROOT_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
ENV_FILE="$ROOT_DIR/.env.local"
WEB_HOST="${DANCE_WEB_HOST:-0.0.0.0}"
WEB_PORT="${DANCE_WEB_PORT:-8000}"
LOCAL_HOSTNAME="$(scutil --get LocalHostName 2>/dev/null || true)"

cd "$ROOT_DIR"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "未找到 $PYTHON_BIN，请先安装 Python 3。"
  exit 1
fi

if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

if [ -f "$ENV_FILE" ]; then
  echo "加载本地环境配置 $ENV_FILE"
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

python -m pip install --upgrade pip
python -m pip install -r "$ROOT_DIR/dance_generator_rebuilt/requirements.txt"

echo "启动舞曲生成器 Web..."
echo "本机访问 http://127.0.0.1:$WEB_PORT"
echo "局域网访问 http://$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '本机局域网IP'):$WEB_PORT"
if [ -n "$LOCAL_HOSTNAME" ]; then
  echo "局域网稳定地址 http://$LOCAL_HOSTNAME.local:$WEB_PORT"
fi
if [ -z "${DANCE_LIBRARY_GITHUB_TOKEN:-}" ]; then
  echo "警告：未配置 DANCE_LIBRARY_GITHUB_TOKEN，后端自动保存 GitHub 将不可用。"
  echo "可在 $ENV_FILE 中写入：export DANCE_LIBRARY_GITHUB_TOKEN=你的新Token"
fi
python -m dance_generator_rebuilt.web
