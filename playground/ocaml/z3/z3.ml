(* SMT-LIB 2 printing stand-in for the Z3 OCaml bindings (see dune). *)

type context = {
  decls : (string, string) Hashtbl.t;  (* key -> declaration *)
  mutable order : string list;         (* declarations, newest first *)
  mutable timeout : string option;
  mutable fresh : int;
}

let mk_context (_ : (string * string) list) : context =
  { decls = Hashtbl.create 16; order = []; timeout = None; fresh = 0 }

(* Symbols are always quoted, since Lex names contain '.', ':', '~' etc. *)
let shim_quote s =
  let s = String.map (function '|' | '\\' -> '_' | c -> c) s in
  "|" ^ s ^ "|"

let shim_declare ctx key decl =
  if not (Hashtbl.mem ctx.decls key) then begin
    Hashtbl.add ctx.decls key decl;
    ctx.order <- decl :: ctx.order
  end

let shim_sexp head args =
  match args with
  | [] -> head
  | _ -> "(" ^ String.concat " " (head :: args) ^ ")"

module Symbol = struct
  type symbol = string
  let mk_string (_ : context) (s : string) : symbol = s
end

module Sort = struct
  type sort = string
  let mk_uninterpreted_s ctx s =
    let q = shim_quote ("T:" ^ s) in
    shim_declare ctx ("sort " ^ q) (Printf.sprintf "(declare-sort %s 0)" q);
    q
end

(* An expression is printed lazily, because bound variables are de Bruijn
   indices (Quantifier.mk_bound) and their names are known only once the
   enclosing quantifiers are printed. *)
module Expr = struct
  type expr = string list -> string
  let mk_const_s ctx name (sort : Sort.sort) : expr =
    let q = shim_quote name in
    let key = "const " ^ q in
    let q =
      match Hashtbl.find_opt ctx.decls key with
      | Some d when d <> Printf.sprintf "(declare-const %s %s)" q sort ->
         (* same name at another sort: Z3 treats them as distinct constants *)
         let q' = shim_quote (name ^ "@" ^ sort) in
         shim_declare ctx ("const " ^ q') (Printf.sprintf "(declare-const %s %s)" q' sort);
         q'
      | _ ->
         shim_declare ctx key (Printf.sprintf "(declare-const %s %s)" q sort);
         q in
    fun _ -> q
  let mk_app (_ : context) (f : string) (args : expr list) : expr =
    fun env -> shim_sexp f (List.map (fun a -> a env) args)
  let to_string (e : expr) = e []
end

module FuncDecl = struct
  type func_decl = string
  let mk_func_decl_s ctx name (args : Sort.sort list) (ret : Sort.sort) : func_decl =
    let q = shim_quote name in
    shim_declare ctx ("fun " ^ q)
      (Printf.sprintf "(declare-fun %s (%s) %s)" q (String.concat " " args) ret);
    q
end

let shim_lit s : Expr.expr = fun _ -> s
let shim_app head args : Expr.expr = fun env -> shim_sexp head (List.map (fun a -> a env) args)

module Boolean = struct
  let mk_sort (_ : context) : Sort.sort = "Bool"
  let mk_true (_ : context) = shim_lit "true"
  let mk_false (_ : context) = shim_lit "false"
  let mk_not (_ : context) e = shim_app "not" [e]
  let mk_and (_ : context) = function [] -> shim_lit "true" | [e] -> e | es -> shim_app "and" es
  let mk_or (_ : context) = function [] -> shim_lit "false" | [e] -> e | es -> shim_app "or" es
  let mk_implies (_ : context) a b = shim_app "=>" [a; b]
  let mk_eq (_ : context) a b = shim_app "=" [a; b]
end

module Arithmetic = struct
  module Integer = struct
    let mk_sort (_ : context) : Sort.sort = "Int"
    let mk_numeral_i (_ : context) i =
      if i >= 0 then shim_lit (string_of_int i) else shim_lit (Printf.sprintf "(- %d)" (-i))
  end
  let mk_le (_ : context) a b = shim_app "<=" [a; b]
  let mk_lt (_ : context) a b = shim_app "<" [a; b]
  let mk_ge (_ : context) a b = shim_app ">=" [a; b]
  let mk_gt (_ : context) a b = shim_app ">" [a; b]
  let mk_add (_ : context) es = shim_app "+" es
  let mk_sub (_ : context) es = shim_app "-" es
  let mk_mul (_ : context) es = shim_app "*" es
  let mk_div (_ : context) a b = shim_app "div" [a; b]
end

module Seq = struct
  let mk_string_sort (_ : context) : Sort.sort = "String"
  let mk_string (_ : context) s =
    let b = Buffer.create (String.length s + 2) in
    Buffer.add_char b '"';
    String.iter (fun c -> if c = '"' then Buffer.add_string b "\"\"" else Buffer.add_char b c) s;
    Buffer.add_char b '"';
    shim_lit (Buffer.contents b)
end

module FloatingPoint = struct
  let mk_sort_double (_ : context) : Sort.sort = "(_ FloatingPoint 11 53)"
  let mk_numeral_f (_ : context) (f : float) (_ : Sort.sort) =
    let a = Float.abs f in
    let r = if Float.is_integer a then Printf.sprintf "%.1f" a else Printf.sprintf "%.17f" a in
    let r = if f < 0. then Printf.sprintf "(- %s)" r else r in
    shim_lit (Printf.sprintf "((_ to_fp 11 53) RNE %s)" r)
end

module Quantifier = struct
  type quantifier = Expr.expr
  let mk_bound (_ : context) i (_ : Sort.sort) : Expr.expr =
    fun env -> List.nth env i
  let mk_q kind ctx sorts names body _w _p _np _qid _skid : quantifier =
    match sorts, names with
    | [sort], [name] ->
       fun env ->
         ctx.fresh <- ctx.fresh + 1;
         let v = shim_quote (Printf.sprintf "%s!%d" name ctx.fresh) in
         Printf.sprintf "(%s ((%s %s)) %s)" kind v sort (body (v :: env))
    | _ -> failwith "Z3 stand-in: only single-variable quantifiers are supported"
  let mk_forall ctx sorts names body w p np qid skid = mk_q "forall" ctx sorts names body w p np qid skid
  let mk_exists ctx sorts names body w p np qid skid = mk_q "exists" ctx sorts names body w p np qid skid
  let expr_of_quantifier (q : quantifier) : Expr.expr = q
end

module Params = struct
  type params = context
  let mk_params ctx = ctx
  let update_param_value ctx key value =
    if key = "timeout" then ctx.timeout <- Some value
end

module Model = struct
  type model = string
  let to_string (m : model) = m
end

(* Set by the web entry point; returns "sat", "unsat" or "unknown". *)
let shim_check_hook : (string -> string) ref = ref (fun script ->
  let open Js_of_ocaml in
  let f = Js.Unsafe.get Js.Unsafe.global (Js.string "lexZ3Check") in
  if Js.to_string (Js.typeof f) = "function" then
    Js.to_string (Js.Unsafe.fun_call f [| Js.Unsafe.inject (Js.string script) |])
  else "unknown")

(* Every query, for the playground's "show SMT-LIB" panel. *)
let shim_log : (string * string) list ref = ref []

module Solver = struct
  type status = UNSATISFIABLE | UNKNOWN | SATISFIABLE
  type solver = { ctx : context; mutable assertions : Expr.expr list }
  let mk_solver ctx (_ : Symbol.symbol option) = { ctx; assertions = [] }
  let set_parameters (_ : solver) (_ : Params.params) = ()
  let add s es = s.assertions <- s.assertions @ es
  let script s =
    let b = Buffer.create 1024 in
    (match s.ctx.timeout with
     | Some t when t <> "0" -> Buffer.add_string b (Printf.sprintf "(set-option :timeout %s)\n" t)
     | _ -> ());
    (* print the assertions first: printing them may add declarations *)
    let asserts = List.map (fun e -> Printf.sprintf "(assert %s)\n" (e [])) s.assertions in
    List.iter (fun d -> Buffer.add_string b d; Buffer.add_char b '\n') (List.rev s.ctx.order);
    List.iter (Buffer.add_string b) asserts;
    Buffer.add_string b "(check-sat)\n";
    Buffer.contents b
  let check s (_ : Expr.expr list) =
    let script = script s in
    let answer = String.trim (!shim_check_hook script) in
    shim_log := (script, answer) :: !shim_log;
    match answer with
    | "unsat" -> UNSATISFIABLE
    | "sat" -> SATISFIABLE
    | _ -> UNKNOWN
  let get_model (_ : solver) : Model.model option = Some "(model not available in the browser build)"
end
