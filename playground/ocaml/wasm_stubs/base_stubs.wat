;; Wasm versions of the C primitives that Jane Street's base, time_now and
;; ocaml_intrinsics_kernel use. These libraries (v0.17) ship JavaScript
;; versions for js_of_ocaml, but none for wasm_of_ocaml. Each function below
;; mirrors the JavaScript version in that library's runtime.js. OCaml ints are
;; 31 bits wide under wasm_of_ocaml. Runtime functions are imported from "env",
;; the module name wasm_of_ocaml gives its merged runtime.
(module
   (import "env" "caml_hash_mix_int"
      (func $caml_hash_mix_int (param i32) (param i32) (result i32)))
   (import "env" "caml_hash_mix_int64"
      (func $caml_hash_mix_int64 (param i32) (param i64) (result i32)))
   (import "env" "caml_hash_mix_double"
      (func $caml_hash_mix_double (param i32) (param f64) (result i32)))
   (import "env" "caml_hash_mix_string"
      (func $caml_hash_mix_string (param i32) (param (ref $bytes)) (result i32)))
   (import "env" "caml_hash_mix_final"
      (func $caml_hash_mix_final (param i32) (result i32)))
   (import "env" "caml_hash"
      (func $caml_hash
         (param (ref eq)) (param (ref eq)) (param (ref eq)) (param (ref eq))
         (result (ref eq))))
   (import "env" "Int64_val" (func $Int64_val (param (ref eq)) (result i64)))
   (import "env" "caml_copy_int64"
      (func $caml_copy_int64 (param i64) (result (ref eq))))
   (import "env" "Int32_val" (func $Int32_val (param (ref eq)) (result i32)))
   (import "bindings" "time" (func $time (result f64)))

   (type $bytes (array (mut i8)))
   (type $float (struct (field $f f64)))

   (func $int (param $v (ref eq)) (result i32)
      (i31.get_s (ref.cast (ref i31) (local.get $v))))
   (func $uint (param $v (ref eq)) (result i32)
      (i31.get_u (ref.cast (ref i31) (local.get $v))))
   (func $val (param $i i32) (result (ref eq)) (ref.i31 (local.get $i)))

   ;; base: testing and backtraces
   (func (export "Base_am_testing") (param (ref eq)) (result (ref eq))
      (ref.i31 (i32.const 0)))
   (func (export "Base_clear_caml_backtrace_pos")
      (param (ref eq)) (result (ref eq))
      (ref.i31 (i32.const 0)))
   (func (export "Base_caml_exn_is_most_recent_exn")
      (param (ref eq)) (result (ref eq))
      (ref.i31 (i32.const 1)))

   ;; base: bit counting
   (func (export "Base_int_math_int_popcount") (param $x (ref eq)) (result (ref eq))
      (call $val (i32.popcnt (call $uint (local.get $x)))))
   (func (export "Base_int_math_int_clz") (param $x (ref eq)) (result (ref eq))
      ;; leading zeros within 31 bits
      (call $val (i32.sub (i32.clz (call $uint (local.get $x))) (i32.const 1))))
   (func (export "Base_int_math_int_ctz") (param $x (ref eq)) (result (ref eq))
      (call $val
         (i32.ctz (i32.or (call $uint (local.get $x)) (i32.const 0x80000000)))))
   (func (export "Base_int_math_int32_clz") (param $x (ref eq)) (result (ref eq))
      (call $val (i32.clz (call $Int32_val (local.get $x)))))
   (func (export "Base_int_math_int32_ctz") (param $x (ref eq)) (result (ref eq))
      (call $val (i32.ctz (call $Int32_val (local.get $x)))))
   (func (export "Base_int_math_nativeint_clz") (param $x (ref eq)) (result (ref eq))
      (call $val (i32.clz (call $Int32_val (local.get $x)))))
   (func (export "Base_int_math_nativeint_ctz") (param $x (ref eq)) (result (ref eq))
      (call $val (i32.ctz (call $Int32_val (local.get $x)))))
   (func (export "Base_int_math_int64_clz") (param $x (ref eq)) (result (ref eq))
      (call $val (i32.wrap_i64 (i64.clz (call $Int64_val (local.get $x))))))
   (func (export "Base_int_math_int64_ctz") (param $x (ref eq)) (result (ref eq))
      (call $val (i32.wrap_i64 (i64.ctz (call $Int64_val (local.get $x))))))

   ;; base: integer powers (wrapping, like the C and JavaScript versions)
   (func (export "Base_int_math_int_pow_stub")
      (param $b (ref eq)) (param $e (ref eq)) (result (ref eq))
      (local $base i32) (local $exp i32) (local $res i32)
      (local.set $base (call $int (local.get $b)))
      (local.set $exp (call $int (local.get $e)))
      (local.set $res (i32.const 1))
      (block $done
         (loop $loop
            (br_if $done (i32.le_s (local.get $exp) (i32.const 0)))
            (if (i32.and (local.get $exp) (i32.const 1))
               (then (local.set $res (i32.mul (local.get $res) (local.get $base)))))
            (local.set $base (i32.mul (local.get $base) (local.get $base)))
            (local.set $exp (i32.shr_u (local.get $exp) (i32.const 1)))
            (br $loop)))
      (call $val (local.get $res)))
   (func (export "Base_int_math_int64_pow_stub")
      (param $b (ref eq)) (param $e (ref eq)) (result (ref eq))
      (local $base i64) (local $exp i64) (local $res i64)
      (local.set $base (call $Int64_val (local.get $b)))
      (local.set $exp (call $Int64_val (local.get $e)))
      (local.set $res (i64.const 1))
      (block $done
         (loop $loop
            (br_if $done (i64.le_s (local.get $exp) (i64.const 0)))
            (if (i32.wrap_i64 (i64.and (local.get $exp) (i64.const 1)))
               (then (local.set $res (i64.mul (local.get $res) (local.get $base)))))
            (local.set $base (i64.mul (local.get $base) (local.get $base)))
            (local.set $exp (i64.shr_u (local.get $exp) (i64.const 1)))
            (br $loop)))
      (call $caml_copy_int64 (local.get $res)))

   ;; base: hashing (same mixing functions as OCaml's Hashtbl.hash)
   (func (export "Base_hash_string") (param $s (ref eq)) (result (ref eq))
      (call $caml_hash (ref.i31 (i32.const 1)) (ref.i31 (i32.const 1))
         (ref.i31 (i32.const 0)) (local.get $s)))
   (func (export "Base_hash_double") (param $d (ref eq)) (result (ref eq))
      (call $caml_hash (ref.i31 (i32.const 1)) (ref.i31 (i32.const 1))
         (ref.i31 (i32.const 0)) (local.get $d)))
   (func (export "Base_internalhash_fold_int")
      (param $h (ref eq)) (param $d (ref eq)) (result (ref eq))
      (call $val
         (call $caml_hash_mix_int (call $int (local.get $h)) (call $int (local.get $d)))))
   (func (export "Base_internalhash_fold_int64")
      (param $h (ref eq)) (param $d (ref eq)) (result (ref eq))
      (call $val
         (call $caml_hash_mix_int64 (call $int (local.get $h))
            (call $Int64_val (local.get $d)))))
   (func (export "Base_internalhash_fold_float")
      (param $h (ref eq)) (param $d (ref eq)) (result (ref eq))
      (call $val
         (call $caml_hash_mix_double (call $int (local.get $h))
            (struct.get $float $f (ref.cast (ref $float) (local.get $d))))))
   (func (export "Base_internalhash_fold_string")
      (param $h (ref eq)) (param $s (ref eq)) (result (ref eq))
      (call $val
         (call $caml_hash_mix_string (call $int (local.get $h))
            (ref.cast (ref $bytes) (local.get $s)))))
   (func (export "Base_internalhash_get_hash_value")
      (param $h (ref eq)) (result (ref eq))
      (call $val
         (i32.and (call $caml_hash_mix_final (call $int (local.get $h)))
            (i32.const 0x3FFFFFFF))))

   ;; ocaml_intrinsics_kernel: conditional select
   (func (export "caml_csel_value")
      (param $c (ref eq)) (param $t (ref eq)) (param $f (ref eq)) (result (ref eq))
      (if (result (ref eq)) (call $int (local.get $c))
         (then (local.get $t)) (else (local.get $f))))

   ;; time_now: monotonic counter in nanoseconds. Int63 is emulated with an
   ;; int64 whose lowest bit is zero, as in the JavaScript version.
   (func (export "time_now_nanosecond_counter_for_timing")
      (param (ref eq)) (result (ref eq))
      (call $caml_copy_int64
         (i64.shl (i64.trunc_sat_f64_s (f64.mul (call $time) (f64.const 1e6)))
            (i64.const 1))))
)
