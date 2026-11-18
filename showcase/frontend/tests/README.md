# Frontend tests

Run all tests with Node's built-in test runner:

```powershell
node --test tests/*.test.mjs
```

The suite has four test areas:

- Adapter contract and async benchmark frame path:
  `adapter-contract.test.mjs`, `benchmark-adapter.test.mjs`
- Video pipeline timing, abort, seek, and aspect:
  `video-pipeline.test.mjs`
- Benchmark verdict and budget rules:
  `benchmark-rules.test.mjs`
- Head pitch and camera mirror behavior:
  `mirror.test.mjs`

Browser-specific MediaPipe behavior is covered by manual smoke tests.
