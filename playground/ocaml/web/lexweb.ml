(* Browser entry point for Lex. JavaScript calls

     lexRun(mode, mainFile, names, contents, timeoutMs)

   with mode "mfotl" or "doc", and gets back { ok, output, log, smt }. On
   output is the result or the errors, and log is what Lex printed on the
   way (warnings and debug lines).
   smt is the list of [script, answer] pairs that went to Z3. Files live in
   the in-memory file system (see [root] below). *)

open Js_of_ocaml
open Lex_lib

let out = Buffer.create 4096

(* Output goes to [out] while Lex runs, and to the console otherwise, so that
   errors outside a run (such as a fatal exception) stay visible. *)
let capture on =
  let to_console s =
    ignore (Js.Unsafe.meth_call (Js.Unsafe.get Js.Unsafe.global (Js.string "console")) "log"
              [| Js.Unsafe.inject (Js.string s) |]) in
  let f = if on then Buffer.add_string out else to_console in
  Sys_js.set_channel_flusher stdout f;
  Sys_js.set_channel_flusher stderr f

(* wasm_of_ocaml's browser file system only knows files registered with
   [Sys_js.create_file], looked up by the exact path string, and it cannot
   create directories or write files. So under Wasm every path is absolute
   under [root], and files are only ever registered, never written. *)
let wasm = match Sys.backend_type with Other "js_of_ocaml" -> false | _ -> true
let root = if wasm then "/static" else "."
let path name = if wasm then root ^ "/" ^ name else name

let () =
  capture false;
  if not wasm then (try Sys.chdir "/static" with _ -> ())

let write_file name content =
  if wasm then Sys_js.create_file ~name:(path name) ~content else
  let rec mkdirs d =
    if d <> "." && d <> "/" && d <> "" && not (Sys.file_exists d) then begin
      mkdirs (Filename.dirname d);
      (try Sys.mkdir d 0o755 with _ -> ())
    end in
  mkdirs (Filename.dirname name);
  if Sys.file_exists name then Sys_js.update_file ~name ~content
  else Sys_js.create_file ~name ~content

let run mode main names contents timeout =
  Buffer.clear out;
  capture true;
  let log = ref "" in
  let take_log () = log := !log ^ Buffer.contents out; Buffer.clear out in
  Z3.shim_log := [];
  let filepath =
    match Filename.dirname main with "." -> root | d -> path d
  and basename = Filename.basename main in
  let ok =
    try
      Util.z3_to := timeout;
      List.iter2 write_file names contents;
      let open Errors.OrErrors in
      match Modules.do_type [root] MFOTL_lib.Time.Span.zero filepath basename with
      | Errors errs ->
         take_log ();
         Buffer.add_string out (Errors.to_string_multiple errs); false
      | Ok (_, eprog) ->
         (match mode with
          | "doc" ->
             (* Doc.to_file, without writing a file. *)
             let asset f = In_channel.with_open_bin (path ("assets/" ^ f)) In_channel.input_all in
             let html =
               Doc.html_of_eprog ("Lexdoc: " ^ basename)
                 (asset "lexdoc.css") (asset "lexdoc.js") eprog in
             take_log ();
             Buffer.add_string out html
          | _ ->
             let cprog = Compiler.compile eprog false false in
             Format.pp_print_flush Format.std_formatter ();
             flush stdout; flush stderr;
             take_log ();
             Buffer.add_string out (Clex.to_string cprog));
         true
    with e ->
      Format.pp_print_flush Format.std_formatter ();
      flush stdout; flush stderr;
      take_log ();
      Buffer.add_string out ("\nUncaught exception: " ^ Printexc.to_string e ^ "\n");
      false in
  Format.pp_print_flush Format.std_formatter ();
  flush stdout; flush stderr;
  capture false;
  (* Show paths as the page names them, without [root]. *)
  let unroot s =
    if not wasm then s else
    let r = root ^ "/" and b = Buffer.create (String.length s) in
    let n = String.length r and i = ref 0 in
    while !i < String.length s do
      if !i + n <= String.length s && String.sub s !i n = r then i := !i + n
      else (Buffer.add_char b s.[!i]; incr i)
    done;
    Buffer.contents b in
  let smt =
    List.rev_map (fun (s, a) ->
        Js.array [| Js.Unsafe.inject (Js.string s); Js.Unsafe.inject (Js.string a) |])
      !Z3.shim_log in
  Js.Unsafe.obj [|
      "ok", Js.Unsafe.inject (Js.bool ok);
      "output", Js.Unsafe.inject (Js.string (unroot (Buffer.contents out)));
      "log", Js.Unsafe.inject (Js.string (unroot !log));
      "smt", Js.Unsafe.inject (Js.array (Array.of_list smt));
    |]

let () =
  let strings a = Array.to_list (Array.map Js.to_string (Js.to_array a)) in
  Js.Unsafe.set Js.Unsafe.global (Js.string "lexRun")
    (Js.wrap_callback (fun mode main names contents timeout ->
         try
           run (Js.to_string mode) (Js.to_string main) (strings names) (strings contents)
             (Js.to_string timeout)
         with e ->
           (* Never let an OCaml exception escape to JavaScript. *)
           capture false;
           Js.Unsafe.obj [|
               "ok", Js.Unsafe.inject Js._false;
               "output", Js.Unsafe.inject (Js.string ("lexRun failed: " ^ Printexc.to_string e));
               "log", Js.Unsafe.inject (Js.string (Buffer.contents out));
               "smt", Js.Unsafe.inject (Js.array [||]);
             |]))
