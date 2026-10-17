# Frontend tests

Run with Node's built-in test runner:

```powershell
node --experimental-default-type=module --test tests\adapter-contract.test.mjs tests\video-pipeline.test.mjs
```

These tests cover the adapter contract and the video pipeline. Browser-specific MediaPipe behavior is covered by manual smoke tests.
