#!/usr/bin/env bash
# Project quality gate. Detects the stack in the target directory (default: $PWD)
# and runs what exists. Every check prints PASS/FAIL/SKIP with a reason; the exit
# code is non-zero if any executed check failed. Never installs anything.
#   verify.sh [--quick] [--dir PATH]
#   --quick : fast post-merge smoke (compile + unit tests); default is the full gate.
set -uo pipefail

MODE=full
DIR="$PWD"
while [ $# -gt 0 ]; do
  case "$1" in
    --quick) MODE=quick ;;
    --dir) DIR="$2"; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
cd "$DIR" || exit 2

FAILED=0
RAN=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1 (exit $2)"; FAILED=1; }
skip() { echo "SKIP  $1 - $2"; }
run() {  # run <label> <cmd...>
  local label="$1"; shift
  RAN=$((RAN + 1))
  echo "----- $label: $*"
  "$@"; local rc=$?
  if [ $rc -eq 0 ]; then pass "$label"; else fail "$label" $rc; fi
  return $rc
}

echo "verify.sh mode=$MODE dir=$DIR"

# Repository hygiene (both modes): whitespace errors in tracked changes vs HEAD.
if git rev-parse --git-dir >/dev/null 2>&1; then
  run "git diff --check" git diff --check HEAD
fi

# --- Java / Gradle
if [ -x ./gradlew ]; then
  if [ "$MODE" = quick ]; then
    run "gradle test (compile + unit tests)" ./gradlew --console=plain -q test
  else
    run "gradle build (compile, test, check, jar)" ./gradlew --console=plain build
  fi
elif [ -f pom.xml ] && command -v mvn >/dev/null; then
  if [ "$MODE" = quick ]; then run "maven test" mvn -q test; else run "maven verify" mvn -q verify; fi
fi

# --- Node
if [ -f package.json ] && command -v npm >/dev/null; then
  for s in lint typecheck test build; do
    if node -e "process.exit(require('./package.json').scripts?.['$s'] ? 0 : 1)" 2>/dev/null; then
      if [ "$MODE" = quick ] && { [ "$s" = lint ] || [ "$s" = build ]; }; then skip "npm run $s" "quick mode"; continue; fi
      run "npm run $s" npm run -s "$s"
    else
      skip "npm run $s" "no script"
    fi
  done
fi

# --- Go
if [ -f go.mod ] && command -v go >/dev/null; then
  run "go vet" go vet ./...
  if [ "$MODE" = quick ]; then run "go test" go test ./...; else run "go test -race" go test -race ./...; fi
fi

# --- Rust
if [ -f Cargo.toml ] && command -v cargo >/dev/null; then
  [ "$MODE" = full ] && run "cargo clippy" cargo clippy --all-targets -- -D warnings
  run "cargo test" cargo test
fi

# --- Python (pyproject / setup / requirements / pytest or tox config)
if [ -f pyproject.toml ] || [ -f pytest.ini ] || [ -f setup.cfg ] || [ -f setup.py ] || [ -f tox.ini ] \
   || compgen -G 'requirements*.txt' >/dev/null; then
  if python3 -c 'import pytest' 2>/dev/null; then
    echo "----- pytest: python3 -m pytest -q -p no:cacheprovider"
    python3 -m pytest -q -p no:cacheprovider; rc=$?   # no .pytest_cache left in the worktree
    if [ $rc -eq 5 ]; then
      skip "pytest" "no tests collected"
    else
      RAN=$((RAN + 1))
      if [ $rc -eq 0 ]; then pass "pytest"; else fail "pytest" $rc; fi
    fi
  else
    skip "pytest" "Python project but pytest is not installed (python3 -m pip install pytest)"
  fi
fi

# --- C / C++ (CMake builds out of tree in a temp dir; a Makefile counts only next to C/C++ sources)
if [ -f CMakeLists.txt ]; then
  if command -v cmake >/dev/null; then
    BUILD="$(mktemp -d)"
    run "cmake configure" cmake -S . -B "$BUILD" -DCMAKE_BUILD_TYPE=Debug \
      && run "cmake build" cmake --build "$BUILD" -j "$(nproc 2>/dev/null || echo 2)" \
      && if command -v ctest >/dev/null; then run "ctest" ctest --test-dir "$BUILD" --output-on-failure; fi
    rm -rf "$BUILD"
  else
    skip "cmake" "CMakeLists.txt found but cmake is not installed"
  fi
elif { [ -f Makefile ] || [ -f makefile ] || [ -f GNUmakefile ]; } && command -v make >/dev/null \
     && git ls-files '*.c' '*.cc' '*.cpp' '*.cxx' '*.h' '*.hh' '*.hpp' 2>/dev/null | grep -q .; then
  if run "make" make -j "$(nproc 2>/dev/null || echo 2)"; then
    for t in test check; do
      if make -n "$t" >/dev/null 2>&1; then run "make $t" make "$t"; break; fi
    done
  fi
fi

# --- Orchestration scaffold self-test (full mode, when present)
if [ "$MODE" = full ] && [ -d .agent-system/tests ]; then
  run "agent-system scheduler tests" python3 -m unittest discover -s .agent-system/tests -q
fi

if [ $RAN -eq 0 ]; then
  skip "build/test" "no recognized stack in $DIR"
fi
echo "verify.sh result: $([ $FAILED -eq 0 ] && echo PASS || echo FAIL) ($RAN checks run)"
exit $FAILED
