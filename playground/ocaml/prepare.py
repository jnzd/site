#!/usr/bin/env python3
"""Assembles a dune project that builds Lex for the browser.

Usage: prepare.py LEX_CHECKOUT OUT_DIR

LEX_CHECKOUT is a clone of github.com/francois-hublet/lex with its enfguard
submodule. OUT_DIR gets Lex's src/ and MFOTL_lib/ with a few small patches
(no Unix process or file-system calls, Z3 replaced by the stand-in in z3/),
plus z3/, web/ and wasm_stubs/ from this folder. Lex itself is not changed.
"""
import os, re, shutil, sys

lex, out = sys.argv[1], sys.argv[2]
here = os.path.dirname(os.path.abspath(__file__))
if os.path.exists(out):
    shutil.rmtree(out)
os.makedirs(out)

shutil.copytree(os.path.join(lex, "src"), os.path.join(out, "src"))
shutil.copytree(os.path.realpath(os.path.join(lex, "MFOTL_lib")), os.path.join(out, "MFOTL_lib"))
shutil.copytree(os.path.join(lex, "assets"), os.path.join(out, "assets"))
shutil.copytree(os.path.join(here, "z3"), os.path.join(out, "z3"))
shutil.copytree(os.path.join(here, "web"), os.path.join(out, "web"))
shutil.copytree(os.path.join(here, "wasm_stubs"), os.path.join(out, "wasm_stubs"))

with open(os.path.join(out, "dune-project"), "w") as f:
    f.write("(lang dune 3.17)\n(using menhir 3.0)\n")
with open(os.path.join(out, "dune"), "w") as f:
    f.write("(env (_ (flags (:standard -w -a))))\n")

def patch(path, old, new, count=1):
    p = os.path.join(out, path)
    s = open(p).read()
    if old not in s:
        sys.exit(f"prepare.py: patch target not found in {path}: {old[:60]!r}")
    s = s.replace(old, new, count)
    open(p, "w").write(s)

# Libraries with C stubs that the browser build cannot use.
patch("src/dune", " core_unix core_unix.sys_unix", "")
patch("MFOTL_lib/dune", " pyml", "")

# File lookups and assets: plain Stdlib calls on js_of_ocaml's in-memory files.
patch("src/modules.ml",
      "Sys_unix.is_file_exn ~follow_symlinks:false (Filename.concat prefix filename)",
      "Stdlib.Sys.file_exists (Filename.concat prefix filename)")
patch("src/doc.ml", "Filename.dirname ((Sys.get_argv ()).(0))", '"."', count=2)

# Ontology diagrams pipe through Graphviz: not available in the browser.
p = os.path.join(out, "src/owl.ml")
s = open(p).read()
i = s.index("let to_png filename eprog =")
s = s[:i] + 'let to_png _filename _eprog =\n  raise (Graphviz_error "Graphviz is not available in the browser")\n'
open(p, "w").write(s)

print("prepared", out)
