#!/bin/sh
# Mirror godot/ to a scratch copy and run the bombers' test there (never in godot/ itself: other sessions work in it).
#   sh run.sh <scratch folder> <mode: views|mission|frames> [more args]
# Stand-ins (tests/bombers/standins, city_standin.gd) go into the copy only where the real file is missing or
# doesn't compile yet.
S="$1"; MODE="$2"; shift 2
G="C:/Users/Garre/Tools/godot/Godot_v4.7.2-stable_win64_console.exe"
robocopy 'C:\Users\Garre\Documents\bomber-game\godot' "$(cygpath -w "$S")\godot" //MIR //NFL //NDL //NJH //NJS //XD .godot >/dev/null
cd "$S/godot"
[ -f src/city.gd ] || cp tests/bombers/city_standin.gd src/city.gd
for f in world effects; do
  cat > /tmp/chk_$$.gd <<EOT
extends SceneTree
func _init():
	var s = load("res://src/$f.gd")
	print("COMPILES " if s and s.can_instantiate() else "BROKEN ")
	quit()
EOT
  cp /tmp/chk_$$.gd tests/bombers/_chk.gd
  if ! "$G" --headless --path . -s res://tests/bombers/_chk.gd 2>/dev/null | grep -q COMPILES; then cp tests/bombers/standins/$f.gd src/$f.gd; echo "stand-in: $f.gd"; fi
done
rm -f tests/bombers/_chk.gd /tmp/chk_$$.gd
mkdir -p "$S/out"
"$G" --path . res://tests/bombers/mission_test.tscn -- --out="$(cygpath -w "$S/out")" --mode=$MODE "$@" 2>&1 | grep -v "^$\|   at: \|Leaked\|RID allocations\|resources still\|ObjectDB"
