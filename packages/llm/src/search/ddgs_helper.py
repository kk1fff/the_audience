"""Bounded DDGS adapter. Receives an approved public-topic query only."""
import json
import sys

from ddgs import DDGS

request = json.load(sys.stdin)
query = request["query"]
limit = max(1, min(2, int(request.get("limit", 1))))
results = DDGS(timeout=2).text(query, max_results=limit, backend="auto", safesearch="moderate")
json.dump(results[:limit], sys.stdout)
