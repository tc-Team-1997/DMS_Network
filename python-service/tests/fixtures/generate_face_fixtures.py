"""Script to document how face_*.jpg test fixtures were generated.

These fixtures are synthetic — NOT real customer data.
They are generated using Pillow to produce simple geometric "face-like" images
that face_recognition/dlib can detect if installed, or that can be used with
mocks when face_recognition is not available.

In CI (face_recognition not installed), all dlib-dependent tests are skipped via
pytest.importorskip('face_recognition') at the top of test_face_match.py.

For generating real dlib-detectable fixtures:
  pip install face_recognition
  python -m tests.fixtures.generate_face_fixtures
"""
# This file is documentation-only; actual fixtures are static JPEG files
# committed to the repo.
