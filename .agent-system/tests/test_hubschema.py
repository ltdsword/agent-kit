"""Contract tests for the Agent Hub protocol, Python side (see hub/protocol/test/contract.test.ts).

The fixtures live in the kit repo (hub/protocol/fixtures); in an installed workspace they are
absent and those tests skip.
"""
import json
import sys
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT))
import hubschema  # noqa: E402

REPO = KIT.parent
FIXTURES = REPO / "hub" / "protocol" / "fixtures"
SOURCE = REPO / "hub" / "protocol" / "schemas" / "protocol.schema.json"


def _def(path: Path) -> str:
    return path.name.split(".")[0]


class TestHubSchema(unittest.TestCase):
    def test_copy_matches_source(self):
        if not SOURCE.exists():
            self.skipTest("not in the kit repo")
        self.assertEqual(hubschema.SCHEMA_PATH.read_text(), SOURCE.read_text(),
                         "run `npm run gen -w @agent-hub/protocol` in hub/")

    def test_valid_fixtures(self):
        if not FIXTURES.exists():
            self.skipTest("not in the kit repo")
        files = sorted(FIXTURES.glob("*.json"))
        self.assertTrue(files)
        for f in files:
            with self.subTest(f.name):
                self.assertEqual(hubschema.errors(_def(f), json.loads(f.read_text())), [])

    def test_invalid_fixtures(self):
        if not FIXTURES.exists():
            self.skipTest("not in the kit repo")
        for f in sorted((FIXTURES / "invalid").glob("*.json")):
            with self.subTest(f.name):
                self.assertNotEqual(hubschema.errors(_def(f), json.loads(f.read_text())), [])

    def test_messages(self):
        bad = {"choice": "A", "extra": 1}
        self.assertIn("/ has unexpected property extra", hubschema.errors("AnswerRequest", bad))
        self.assertEqual(hubschema.errors("AckRequest", {"status": "DELIVERED", "reason": None}), [])
        with self.assertRaises(ValueError):
            hubschema.validate("TextRequest", {"text": ""})
        with self.assertRaises(KeyError):
            hubschema.errors("NoSuchDef", {})

    def test_schema_uses_supported_subset(self):
        for name in hubschema.schema()["$defs"]:  # every def compiles under the subset
            hubschema.errors(name, None)


if __name__ == "__main__":
    unittest.main()
