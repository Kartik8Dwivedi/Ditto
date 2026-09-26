import json
import math
import unittest

from src.Services.probe.languages.python.harness import (
    UnserializableValueError,
    canonical_serialise,
    extract_and_prepare_candidate,
    invoke_candidate,
)


class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def __repr__(self):
        return f"Point(x={self.x}, y={self.y})"


class TestPrimitives(unittest.TestCase):
    def test_none(self):
        self.assertEqual(canonical_serialise(None), "null")

    def test_booleans(self):
        self.assertEqual(canonical_serialise(True), "true")
        self.assertEqual(canonical_serialise(False), "false")

    def test_bool_is_not_confused_with_int(self):
        self.assertNotEqual(canonical_serialise(True), canonical_serialise(1))

    def test_integers(self):
        self.assertEqual(canonical_serialise(0), "0")
        self.assertEqual(canonical_serialise(-42), "-42")
        self.assertEqual(canonical_serialise(1_000_000), "1000000")

    def test_floats(self):
        self.assertEqual(canonical_serialise(3.14), "3.14")

    def test_negative_zero_preserved(self):
        self.assertEqual(canonical_serialise(-0.0), "-0.0")
        self.assertEqual(canonical_serialise(0.0), "0.0")
        self.assertNotEqual(canonical_serialise(-0.0), canonical_serialise(0.0))

    def test_nan_and_infinity(self):
        self.assertEqual(canonical_serialise(float("nan")), "NaN")
        self.assertEqual(canonical_serialise(float("inf")), "Infinity")
        self.assertEqual(canonical_serialise(float("-inf")), "-Infinity")

    def test_strings_are_json_quoted_and_escaped(self):
        self.assertEqual(canonical_serialise("hello"), '"hello"')
        self.assertEqual(canonical_serialise('he said "hi"'), '"he said \\"hi\\""')

    def test_unicode_string(self):
        self.assertEqual(canonical_serialise("héllo"), '"h\\u00e9llo"')


class TestContainers(unittest.TestCase):
    def test_plain_list(self):
        self.assertEqual(canonical_serialise([1, 2, 3]), "[1,2,3]")

    def test_dict_keys_are_sorted_for_determinism(self):
        self.assertEqual(
            canonical_serialise({"b": 1, "a": 2}),
            canonical_serialise({"a": 2, "b": 1}),
        )
        self.assertEqual(canonical_serialise({"b": 1, "a": 2}), '{"a":2,"b":1}')

    def test_nested_dict_keys_sorted_too(self):
        val = {"z": {"y": 1, "x": 2}, "a": 1}
        self.assertEqual(canonical_serialise(val), '{"a":1,"z":{"x":2,"y":1}}')


    def test_toplevel_tuple_is_tagged_and_distinct_from_list(self):
        self.assertEqual(
            canonical_serialise((1, 2, 3)),
            '{"$type":"tuple","items":[1,2,3]}',
        )
        self.assertNotEqual(canonical_serialise((1, 2, 3)), canonical_serialise([1, 2, 3]))

    def test_nested_tuple_still_tagged(self):
        val = [(1, 2), "x"]
        self.assertEqual(
            canonical_serialise(val),
            '[{"$type":"tuple","items":[1,2]},"x"]',
        )

    def test_deeply_nested_tuple_still_tagged(self):
        val = {"a": [1, (2, (3, 4))]}
        result = canonical_serialise(val)
        self.assertIn('"$type":"tuple"', result)
        parsed = json.loads(result)
        self.assertEqual(parsed["a"][1]["$type"], "tuple")
        self.assertEqual(parsed["a"][1]["items"][1]["$type"], "tuple")

    def test_set_is_sorted_and_tagged(self):
        self.assertEqual(
            canonical_serialise({3, 1, 2}),
            '{"$type":"set","items":[1,2,3]}',
        )

    def test_frozenset_same_as_set(self):
        self.assertEqual(canonical_serialise(frozenset({1, 2})), canonical_serialise({1, 2}))

    def test_set_ordering_is_deterministic_across_runs(self):
        s = {"banana", "apple", "cherry"}
        first = canonical_serialise(s)
        second = canonical_serialise(s)
        self.assertEqual(first, second)


class TestCustomObjects(unittest.TestCase):
    def test_toplevel_custom_object_is_tagged(self):
        result = canonical_serialise(Point(1, 2))
        parsed = json.loads(result)
        self.assertEqual(parsed["$type"], "object")
        self.assertEqual(parsed["class"], "Point")
        self.assertEqual(parsed["repr"], "Point(x=1, y=2)")

    def test_nested_custom_object_is_tagged(self):
        result = canonical_serialise([Point(0, 0)])
        parsed = json.loads(result)
        self.assertEqual(parsed[0]["$type"], "object")
        self.assertEqual(parsed[0]["class"], "Point")


class TestCircularReferences(unittest.TestCase):
    def test_circular_list_does_not_raise(self):
        lst = []
        lst.append(lst)
        result = canonical_serialise(lst) 
        self.assertEqual(result, '["[Circular]"]')

    def test_circular_dict_does_not_raise(self):
        d = {}
        d["self"] = d
        result = canonical_serialise(d)
        self.assertEqual(result, '{"self":"[Circular]"}')

    def test_same_object_in_two_sibling_branches_is_not_a_false_positive(self):
        shared = [1, 2, 3]
        val = {"first": shared, "second": shared}
        result = canonical_serialise(val)
        self.assertNotIn("[Circular]", result)
        self.assertEqual(result, '{"first":[1,2,3],"second":[1,2,3]}')

    def test_legit_string_equal_to_marker_is_not_corrupted(self):
        val = ["[Circular]", "other"]
        result = canonical_serialise(val)
        self.assertEqual(result, '["[Circular]","other"]')


class TestUnserializable(unittest.TestCase):
    def test_function_object_is_unserializable(self):
        with self.assertRaises(UnserializableValueError):
            canonical_serialise(lambda: None)

    def test_class_itself_is_unserializable(self):
        with self.assertRaises(UnserializableValueError):
            canonical_serialise(Point)


class TestInvokeCandidateSuccess(unittest.TestCase):
    def test_success_wraps_result(self):
        def add(a, b):
            return a + b

        raw = invoke_candidate(add, "[2, 3]")
        parsed = json.loads(raw)
        self.assertTrue(parsed["ok"])
        self.assertEqual(parsed["value"], "5")

    def test_success_with_complex_return_type(self):
        def make_pair():
            return (1, 2)

        raw = invoke_candidate(make_pair, "[]")
        parsed = json.loads(raw)
        self.assertTrue(parsed["ok"])
        self.assertEqual(parsed["value"], '{"$type":"tuple","items":[1,2]}')

    def test_success_with_no_arguments(self):
        def greet():
            return "hello"

        raw = invoke_candidate(greet, "[]")
        parsed = json.loads(raw)
        self.assertTrue(parsed["ok"])
        self.assertEqual(parsed["value"], '"hello"')


class TestInvokeCandidateErrors(unittest.TestCase):
    def test_exception_in_candidate_is_reported_as_error(self):
        def boom(*_args):
            raise ValueError("something broke")

        raw = invoke_candidate(boom, "[]")
        parsed = json.loads(raw)
        self.assertFalse(parsed["ok"])
        self.assertEqual(parsed["name"], "ValueError")
        self.assertEqual(parsed["message"], "something broke")

    def test_type_error_on_bad_args_is_reported(self):
        def needs_two(a, b):
            return a + b

        raw = invoke_candidate(needs_two, "[1]")  
        parsed = json.loads(raw)
        self.assertFalse(parsed["ok"])
        self.assertEqual(parsed["name"], "TypeError")

    def test_serialization_failure_is_reported_as_error_not_silent_str(self):
        def returns_a_function():
            return lambda: None

        raw = invoke_candidate(returns_a_function, "[]")
        parsed = json.loads(raw)
        self.assertFalse(parsed["ok"])
        self.assertEqual(parsed["name"], "UnserializableValueError")

    def test_keyboard_interrupt_is_reraised_not_swallowed(self):
        def infinite_loop(*_args):
            raise KeyboardInterrupt()

        with self.assertRaises(KeyboardInterrupt):
            invoke_candidate(infinite_loop, "[]")

    def test_a_successful_circular_return_is_not_reported_as_failure(self):
        def returns_circular(*_args):
            lst = []
            lst.append(lst)
            return lst

        raw = invoke_candidate(returns_circular, "[]")
        parsed = json.loads(raw)
        self.assertTrue(parsed["ok"])
        self.assertEqual(parsed["value"], '["[Circular]"]')


class TestDeterminism(unittest.TestCase):
    def test_same_value_serialised_twice_is_identical(self):
        val = {"b": [1, (2, 3), {4, 5}], "a": None}
        self.assertEqual(canonical_serialise(val), canonical_serialise(val))

    def test_dict_insertion_order_does_not_affect_output(self):
        val1 = {"x": 1, "y": 2, "z": 3}
        val2 = {"z": 3, "x": 1, "y": 2}
        self.assertEqual(canonical_serialise(val1), canonical_serialise(val2))


class TestExtractAndPrepareCandidate(unittest.TestCase):
    def test_extract_standard_function(self):
        scope = {}
        body = "def add(a, b):\n    return a + b"
        fn = extract_and_prepare_candidate(body, None, scope)
        self.assertTrue(callable(fn))
        self.assertEqual(fn(2, 3), 5)
        self.assertIn("add", scope)

    def test_extract_function_with_inner_helper_does_not_confuse_target(self):
        scope = {}
        body = (
            "def compute(x):\n"
            "    def inner_helper(y):\n"
            "        return y * 2\n"
            "    return inner_helper(x) + 1"
        )
        fn = extract_and_prepare_candidate(body, None, scope)
        self.assertTrue(callable(fn))
        self.assertEqual(fn(5), 11)
        self.assertEqual(fn.__name__, "compute")

    def test_extract_function_with_preamble_dependencies(self):
        scope = {}
        preamble = (
            "OFFSET = 100\n"
            "def helper(v):\n"
            "    return v + OFFSET\n"
        )
        body = "def run(x):\n    return helper(x)"
        fn = extract_and_prepare_candidate(body, preamble, scope)
        self.assertTrue(callable(fn))
        self.assertEqual(fn(5), 105)
        self.assertEqual(fn.__name__, "run")

    def test_extract_function_preamble_failure_is_non_fatal(self):
        scope = {}
        bad_preamble = "raise RuntimeError('preamble failed')"
        body = "def independent(x):\n    return x * 10"
        fn = extract_and_prepare_candidate(body, bad_preamble, scope)
        self.assertTrue(callable(fn))
        self.assertEqual(fn(3), 30)

    def test_extract_decorated_function(self):
        scope = {}
        preamble = (
            "def double_result(func):\n"
            "    def wrapper(*args, **kwargs):\n"
            "        return func(*args, **kwargs) * 2\n"
            "    return wrapper\n"
        )
        body = (
            "@double_result\n"
            "def triple(x):\n"
            "    return x * 3"
        )
        fn = extract_and_prepare_candidate(body, preamble, scope)
        self.assertTrue(callable(fn))
        self.assertEqual(fn(4), 24)

    def test_extract_lambda_assignment(self):
        scope = {}
        body = "square = lambda x: x * x"
        fn = extract_and_prepare_candidate(body, None, scope)
        self.assertTrue(callable(fn))
        self.assertEqual(fn(6), 36)

    def test_extract_anonymous_lambda(self):
        scope = {}
        body = "lambda a, b: a * b + 1"
        fn = extract_and_prepare_candidate(body, None, scope)
        self.assertTrue(callable(fn))
        self.assertEqual(fn(3, 4), 13)

    def test_extract_no_callable_raises_value_error(self):
        scope = {}
        body = "x = 42"
        with self.assertRaises(ValueError):
            extract_and_prepare_candidate(body, None, scope)

    def test_extract_syntax_error_in_body_raises(self):
        scope = {}
        body = "def broken(:"
        with self.assertRaises(SyntaxError):
            extract_and_prepare_candidate(body, None, scope)


if __name__ == "__main__":
    unittest.main(verbosity=2)
