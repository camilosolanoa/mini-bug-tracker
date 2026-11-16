import os

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


@pytest.mark.parametrize("path", ["/", "/index.html"])
def test_html_refresh_uses_current_build_even_with_identical_file_metadata(tmp_path, path):
    frontend = tmp_path / "frontend"
    frontend.mkdir()
    document = frontend / "index.html"
    document.write_text('<script src="/assets/build-A.js"></script>', encoding="utf-8")
    with TestClient(create_app(tmp_path / "test.db", frontend_directory=frontend)) as client:
        previous = client.get(path)
        modified = document.stat()
        document.write_text('<script src="/assets/build-B.js"></script>', encoding="utf-8")
        # Build artifacts can have identical sizes and normalized timestamps.
        os.utime(document, ns=(modified.st_atime_ns, modified.st_mtime_ns))
        refreshed = client.get(path, headers={"If-None-Match": previous.headers.get("etag", '"old-build"')})
        assert refreshed.status_code == 200
        assert "build-B.js" in refreshed.text
        assert refreshed.headers["cache-control"] == "no-store"
