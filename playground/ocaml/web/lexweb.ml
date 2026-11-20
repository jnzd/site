(* Browser entry point for Lex. JavaScript calls

     lexRun(mode, mainFile, names, contents, timeoutMs)

   with mode "mfotl" or "doc", and gets back { ok, output, smt }, where smt is
   the list of [script, answer] pairs that went to Z3. Files live in
   js_of_ocaml's in-memory file system, under the working directory. *)

open Js_of_ocaml
open Lex_lib

let out = Buffer.create 4096

let () =
  Sys_js.set_channel_flusher stdout (Buffer.add_string out);
  Sys_js.set_channel_flusher stderr (Buffer.add_string out);
  (try Sys.chdir "/static" with _ -> ())

let write_file name content =
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
  Z3.shim_log := [];
  Util.z3_to := timeout;
  List.iter2 write_file names contents;
  let filepath = Filename.dirname main and basename = Filename.basename main in
  let ok =
    try
      let open Errors.OrErrors in
      match Modules.do_type ["."] MFOTL_lib.Time.Span.zero filepath basename with
      | Errors errs ->
         Buffer.add_string out (Errors.to_string_multiple errs); false
      | Ok (_, eprog) ->
         (match mode with
          | "doc" ->
             let outname = main ^ "_doc.html" in
             Doc.to_file basename outname eprog;
             Buffer.clear out;
             Buffer.add_string out (In_channel.with_open_bin outname In_channel.input_all)
          | _ ->
             let cprog = Compiler.compile eprog false false in
             Buffer.add_string out (Clex.to_string cprog));
         true
    with e ->
      Buffer.add_string out ("\nUncaught exception: " ^ Printexc.to_string e ^ "\n");
      false in
  Format.pp_print_flush Format.std_formatter ();
  flush stdout; flush stderr;
  let smt =
    List.rev_map (fun (s, a) ->
        Js.array [| Js.Unsafe.inject (Js.string s); Js.Unsafe.inject (Js.string a) |])
      !Z3.shim_log in
  Js.Unsafe.obj [|
      "ok", Js.Unsafe.inject (Js.bool ok);
      "output", Js.Unsafe.inject (Js.string (Buffer.contents out));
      "smt", Js.Unsafe.inject (Js.array (Array.of_list smt));
    |]

let () =
  let strings a = Array.to_list (Array.map Js.to_string (Js.to_array a)) in
  Js.Unsafe.set Js.Unsafe.global (Js.string "lexRun")
    (Js.wrap_callback (fun mode main names contents timeout ->
         run (Js.to_string mode) (Js.to_string main) (strings names) (strings contents)
           (Js.to_string timeout)))
