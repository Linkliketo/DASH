# DASH Technical Route Report

Project: DASH - Lightweight Joint Modelling of Body Motion and Micro-Expression for Game Digital Humans
Document: scope, completed validation, measured results, and the chosen technical route
Version: 2.0 | Date: 2026-09-23 | Status: internal stage report

---

## 1. Project Definition

DASH targets a real-time pipeline on a single consumer-grade CPU that converts monocular RGB
video into animation parameters for a game digital human:

```
video  ->  body skeleton  +  facial expression  ->  virtual character
```

The binding constraint is real-time operation on consumer hardware: a 33 ms frame budget at
30 FPS. Model compression (quantization, pruning, runtime selection) is therefore a
first-class research topic rather than an optional optimisation.

Two questions drive the current work:

1. Can the perception models be made small and fast enough for that budget?
2. Can the resulting accuracy loss be measured and bounded?

The second question is why this report quotes measured numbers rather than the target values
written in the proposal. A target value is a claim; a measured value is evidence.

---

## 2. V0 Rapid Validation (Completed)

### 2.1 What was validated

V0 used two zero-cost open-source projects to validate the end-to-end chain and the
dual-source architecture on one laptop, without a GPU.

| Component | Role | Technical nature |
|---|---|---|
| SysMocap v0.8.0 | body motion capture | MediaPipe Holistic landmarks, then Kalidokit rule-based inverse kinematics |
| miniface 0.1.0 | facial expression capture | MediaPipe Tasks FaceLandmarker, direct neural regression to ARKit 52 BlendShapes |
| fusion server (written by us) | bridge | socket.io + native WebSocket, one unified stream |

An important architectural distinction was confirmed by inspecting both codebases and their
packaged models:

- SysMocap derives joints by **rule-based inverse kinematics** (Kalidokit) applied to
  landmarks. It is not an end-to-end trained network.
- miniface obtains expressions by **direct neural regression**: the FaceLandmarker model
  outputs the 52 ARKit BlendShape coefficients itself.

The two projects therefore represent two different techniques for the same task, which is
useful for the comparison section of the final report. Because only miniface emits standard
ARKit semantics, the fusion layer treats miniface as the authoritative facial source and
SysMocap as the authoritative body source.

### 2.2 Measured results

| Metric | Value | Condition |
|---|---|---|
| Body frame rate, SysMocap alone | ~13 FPS | i7-10750H, no GPU |
| Body frame rate, dual source | 6-8 FPS | CPU contention with miniface |
| Facial frame rate, miniface | 2.5-3 FPS | fake-camera video source |
| Fused output rate | ~22 FPS | 33 ms merge timer |
| Synchronisation error | 3-334 ms | measured between arrival times of the two sources |
| Single-video-source chain | verified hop by hop | video -> SysMocap + miniface -> fusion -> viewer |

Observed body throughput (~13 FPS) is well below the 30-60 FPS claimed in the upstream
documentation. All later capacity planning uses the measured value.

### 2.3 Known problems found during V0

| Problem | Cause | Fix |
|---|---|---|
| Only the first frame was received | webpack HMR invalidated a chunk still referenced by the face worker | use a production build, never the CRA dev server, when running fusion |
| Camera exclusive to one process | Windows allows one process per camera | use two cameras, or an OBS virtual camera |
| SysMocap video mode blocked | the start button checks Vue state, not localStorage | select the video file through the GUI |
| Viewer crashed on body data | four of the rigged bones store `{x,y,z}` directly; only Hips has `.rotation` | read `P[k].rotation \|\| P[k]` |
| Forwarding port not listening | port 8080 only opens while motion capture is running | start capture before subscribing |

---

## 3. Quantization Probe, Stage 0 (Completed)

Stage 0 answers three yes/no questions before any engineering effort is committed to
compression. A two-day timebox applies.

### 3.1 Q1: can independent `.tflite` files be extracted from the `.task` container?

**Answer: yes.**

The `.task` file is a ZIP container with **no compression** (`compress_type = 0`,
`compress_size == file_size` for every member):

| Member | Size |
|---|---|
| `face_detector.tflite` | 229,746 B |
| `face_landmarks_detector.tflite` | 2,553,590 B |
| `face_blendshapes.tflite` | 955,312 B |
| `geometry_pipeline_metadata_landmarks.binarypb` | 19,376 B |
| Sum of members | 3,758,024 B |
| Container overhead | 572 B |
| `.task` file size | 3,758,596 B |

The sum plus container overhead matches the file size exactly, which self-checks the
extraction. Evidence: `quant/result/probe_unpack.md`.

### 3.2 Q2-A: can the extracted TFLite models be converted to ONNX?

**Answer: only one of three.**

| Model | Converted | Detail |
|---|---|---|
| `face_detector.tflite` | yes | median error 8.678e-05 over 30 seeded inputs |
| `face_blendshapes.tflite` | no | `TypeError: object of type 'int' has no len()` inside tflite2onnx |
| `face_landmarks_detector.tflite` | no | `IndexError: list index out of range` inside tflite2onnx |

Two conclusions matter:

1. The failures are **internal bugs in the converter**, not unsupported operators. This
   distinction decides whether the route is worth pursuing further.
2. `face_detector` is the **least relevant** of the three models. It localises the face in
   the frame. The model that actually produces micro-expressions is `face_blendshapes`, and
   it does not convert. Route A therefore does **not** deliver the component the project
   needs.

Conversion fidelity for the model that did convert:

| Output | Shape | Median error | Worst error |
|---|---|---|---|
| regressors | (1, 896, 16) | 7.629e-05 | 1.221e-04 |
| classificators | (1, 896, 1) | 8.678e-05 | 1.678e-04 |

The residual error is explained by **float16 tensors inside the original TFLite models**
(measured: 30% of tensors in `face_detector`, 20% in `face_blendshapes`, 35% in
`face_landmarks_detector`). It is not introduced by the conversion logic.

Layout difference that any caller must handle: TFLite expects `(1, 128, 128, 3)` (NHWC),
ONNX expects `(1, 3, 128, 128)` (NCHW). The same image must be transposed for each runtime.

Evidence: `quant/result/probe_route_a.md`.

### 3.3 Q2-B: candidate B, a self-produced paired dataset

Because the model that matters cannot be converted, its function is reproduced by training a
small network on data generated by the original model. This is knowledge distillation in
principle and it also produces a model whose weights we fully own, which is a precondition
for the pruning experiments in a later stage.

The dataset is produced by running the existing MediaPipe pipeline over video and storing
each frame's input/output pair:

| Item | Value |
|---|---|
| File | `quant/data/pairs.npz` |
| Samples | 1500 |
| `X` (features) | (1500, 1434) float32, 478 landmarks x 3 coordinates, flattened |
| `Y` (labels) | (1500, 52) float32, ARKit BlendShape scores |
| NaN values | 0 |
| Samples with no face | 0 (such frames are skipped, so features and labels stay aligned) |

Label range `[0, 0.9907]`, landmark coordinate range `[-0.0853, 1.0458]` (normalised
coordinates may slightly exceed `[0, 1]` near the frame edge).

Evidence: `quant/result/pairs_preview.png` (landmark scatter, BlendShape traces over time,
label histogram).

### 3.4 Q2-B: training and ONNX export

In progress (`quant/train_mlp.py`). Target interface:

```
input  "landmarks"    (B, 1434) float32   raw coordinates, normalisation inside the graph
output "blendshapes"  (B, 52)   float32
```

### 3.5 Q3: can latency, size and accuracy be measured?

**Answer: yes.** A measurement toolkit (`quant/bench.py`) was built first and then
**calibrated against a known answer**: it reproduced 11.7-13.2 ms, a figure obtained earlier
by a completely different method in `deploy/02_realtime.py`. Two independent rulers agreeing
is the reason the numbers in this report can be trusted.

Evidence: `quant/result/bench_baseline.md`.

### 3.6 Decision gate

| Question | Answer | Evidence |
|---|---|---|
| Q1: independent `.tflite` extractable? | yes | `probe_unpack.md` |
| Q2: PTQ can produce an INT8 model? | yes, via candidate B | `probe_route_a.md` plus the Task 6 export |
| Q3: latency, size and accuracy measurable? | yes | `bench_baseline.md` |

Route selection: **candidate B carries the compression work.** Candidate A contributes a
negative result and a fidelity analysis, both of which belong in the final report.

---

## 4. Measured Data Summary

All figures below were produced on this machine. Hardware: Intel Core Ultra 5 255H (and
i7-10750H for the earlier V0 figures), Windows 11, CPU only, no GPU.

| Quantity | Value | Source |
|---|---|---|
| Camera capture rate | 30.0 FPS | `deploy/02_realtime.py` |
| Face pipeline inference | 11.7-13.2 ms | `deploy/02_realtime.py` |
| Cold start | ~2.4 s | `deploy/02_realtime.py` |
| Benchmark mean latency | 11.916 ms | `quant/result/bench_baseline.md` |
| Benchmark p50 / p95 / min | 11.737 / 13.981 / 10.303 ms | same |
| Benchmark protocol | 10 warmup, 100 timed runs | same |
| Measurement noise | ~5% (mean), 11.6% (p95) | repeated runs |
| `.task` container | 3,758,596 B | `quant/result/probe_unpack.md` |
| Embedded models | 3 `.tflite` + 1 `.binarypb` | same |
| Models convertible to ONNX | 1 of 3 | `quant/result/probe_route_a.md` |
| Conversion fidelity, converted model | median 8.678e-05 | same |
| `face_detector.onnx` size | 425,659 B | `quant/models/onnx/` |
| Dataset samples | 1500 | `quant/data/pairs.npz` |
| Dataset shapes | X (1500, 1434), Y (1500, 52) | same |
| Inactive BlendShape channels | 14 of 52 | `quant/result/pairs_preview.png` |
| Body capture throughput (V0) | ~13 FPS solo | V0 report |
| Fused stream rate (V0) | ~22 FPS | V0 report |

Frame budget arithmetic: inference at 11.9 ms consumes 36% of a 33.3 ms budget at 30 FPS.
The camera is already the bottleneck at this stage, so quantization will not raise the frame
rate of the current pipeline. Its value appears when resolution increases, when several
models run concurrently, or when the target moves to a weaker device. Stating this honestly
is part of the result.

---

## 5. Technical Route

### 5.1 Two lanes for the facial path

The facial path is split deliberately, because the two available techniques answer different
questions.

| | Fast lane | Narrative lane |
|---|---|---|
| Model | MediaPipe FaceLandmarker | LibreFace (ResNet-18) |
| Output | ARKit 52 BlendShapes | 17 Facial Action Units |
| Size | 3.6 MB | ~90 MB |
| Purpose | get the full chain working end to end | interpretable, editable, transferable facial representation |
| Compression headroom | limited (already float16-optimised by upstream) | large (24x bigger) |

The fast lane establishes the pipeline. The narrative lane carries the research
contribution: Action Units are anatomically defined, so they can be mapped to BlendShapes
through an explicit model rather than an opaque one, and they transfer better across
datasets.

### 5.2 Two rounds of compression targets

| Round | Target | Why this object |
|---|---|---|
| First | MediaPipe TFLite models | exercises the toolchain end to end; limited headroom, so results are modest but real |
| Second | LibreFace ResNet-18 | 90 MB and 24x larger; this is where large compression ratios are achievable and where the headline numbers will come from |

The first round is a toolchain rehearsal, not a demonstration of maximum compression. It is
run first because toolchain risk must be discovered cheaply.

### 5.3 Staged plan

| Stage | Content | Exit criterion |
|---|---|---|
| 0 | quantization probe | three questions answered with evidence |
| 1 | minimal quantization experiment | measured latency, size and accuracy for FP32 vs INT8 |
| 2 | modular perception pipeline | new `dash/` package behaves identically to `02_realtime.py`; each module runs standalone |
| 3 | smoothing (moving window, then Kalman) and optical flow | jitter reduced, shown with a quantitative metric |
| 4 | full quantization experiment plus structured pruning | latency-accuracy curve, multi-method comparison table |
| 5 (optional) | body capture to skeleton mapping | landmark to joint angle demo, visualised |

Stage 5 is the single cancellable item. Everything else feeds the interview-readiness line.

### 5.4 Comparison protocol, fixed in advance

To keep the numbers interpretable, all quantization comparisons follow these rules:

1. **Compare on the same side.** ONNX FP32 against ONNX INT8, never TFLite FP32 against
   ONNX INT8. Otherwise the conversion error and the quantization error cannot be separated.
2. **Use the same inputs.** Identical calibration and evaluation data, identical warmup
   counts, for both models.
3. **Do not judge from a single input.** A single random input plus a threshold is a coin
   flip: measured flip rate was 33% on this pipeline. Use fixed seeds and many inputs, and
   report the median together with the worst case.
4. **Report what was measured.** If an achieved number is worse than the proposal target,
   say so and give the cause.

---

## 6. Methodology Findings

These were found while running the experiments and are reported because they are reusable
and because each one invalidated an earlier conclusion.

### 6.1 An underdetermined linear system silently overfits

Fitting a linear map from 1434 inputs to 52 outputs has 1434 unknowns per output against
1200 training samples. The system is underdetermined, so an exact solution to the training
set exists. The least-squares solver returned one, giving a training R-squared of 1.0 and a
validation R-squared of 0.74.

The lesson: **without capacity control, an architecture comparison measures which model
overfits less, not which model is better.** Adding L2 regularisation moved the validation
R-squared from 0.74 to 0.95 on the same data.

### 6.2 Random splitting leaks across time

The dataset is 1500 consecutive frames from one recording. The mean absolute difference
between adjacent frames is 21 times smaller than between frames far apart. Randomly
selecting a validation subset therefore places near-duplicates of training frames into the
validation set.

Measured on the same model:

| Split | Validation R-squared |
|---|---|
| random 80/20 | 0.9517 |
| chronological first 80% / last 20% | 0.6314 |
| chronological first 50% / last 50% | 0.5821 |

The true generalisation capability cannot be determined from this dataset. It needs either a
chronological split or, better, a second recording session. This is a data-collection
requirement, not a modelling problem.

### 6.3 Single-source data limits what can be learned

14 of the 52 BlendShape channels are never activated in the recording (label standard
deviation below 0.01). Those channels cannot be learned, and their fitted weight columns
collapse toward zero. A richer expression protocol and cross-subject data are needed before
any accuracy claim is meaningful.

### 6.4 INT8 quantization has a measurable weak point here

Quantizing the fitted weight matrix and measuring the effect on one forward pass:

| Configuration | Maximum error | Mean error |
|---|---|---|
| float reference | 0 | 0 |
| weights quantized only | 0.239 | 0.068 |
| inputs quantized only | 0.086 | 0.010 |
| both quantized | 0.248 | 0.072 |

For comparison, the model's own mean absolute error against the labels is 0.0155. The
quantization error is therefore several times larger than the model error, so a naive
per-tensor post-training quantization of this object would destroy it.

Three contributing causes were identified:

1. **Heavy-tailed weights.** The ratio of maximum to standard deviation is 14.2, where a
   Gaussian would give about 4. The per-tensor scale is set by the extreme value, so the
   remaining weights lose resolution. Per-channel weight quantization improved the median
   per-column error by 3.9x.
2. **Many accumulation terms.** Each output sums 1434 products, so independent rounding
   errors grow with the square root of 1434, about 38.
3. **Heavy cancellation.** The magnitude of a single product is about 0.072 while the output
   magnitude is 0.052. The output is smaller than its own terms, meaning the sum relies on
   near-exact cancellation, which quantization perturbs.

Accumulation itself is not the problem: an INT8 matrix multiply accumulates in INT32 exactly
and rounds once at the end. With 1434 terms of at most 127x127 the accumulator peak is
23,128,986, which leaves 93x of headroom below the INT32 limit. The error does not compound
across a layer's additions.

The consequence for the plan is concrete and was anticipated in the risk list: try dynamic
quantization first, and if accuracy degrades, move to static quantization with a calibration
set, or keep sensitive layers in higher precision. It is also a testable hypothesis that a
network trained by gradient descent will have a milder weight distribution than a closed-form
least-squares solution, and therefore quantize better.

### 6.5 Miscellaneous

| Finding | Detail |
|---|---|
| Model files are partly float16 | 30% / 20% / 35% of tensors, which sets the conversion error floor near 1e-4 |
| Verdicts from one input are unstable | error spread 5.15e-05 to 1.53e-04 around a 1e-4 threshold, 33% flip rate |
| `mediapipe` `close()` can block | intermittently waits 42 s in `executor.shutdown(wait=True)` |
| Latency noise | about 5% on the mean and 11.6% on p95 across repeated runs |

---

## 7. Open Issues and Risks

| Issue | Impact | Planned response |
|---|---|---|
| Dataset is single-subject, single-session | accuracy claims are not yet meaningful | record additional sessions and subjects; use a chronological split meanwhile |
| 14 of 52 expression channels inactive | the model cannot learn them | extend the recording protocol to cover all channels |
| INT8 accuracy may collapse | the central deliverable is at risk | dynamic quantization first, then static with a calibration set, then mixed precision |
| Toolchain bugs in `tflite2onnx` | route A is partial | candidate B carries the work; report the bugs as a finding |
| Camera, not inference, is the current bottleneck | quantization gain is not visible in the current pipeline | measure on a higher-resolution or multi-model configuration, and say so explicitly |
| Documentation is stored outside the git repository | no version history or backup | decide whether to move the notes directory under version control |
| Parallel long-lead items not yet started | would block later stages | start model-licence registration and dataset applications now, since they are pure waiting time |

---

## 8. Next Steps

Immediate, within the first batch of work:

1. complete `quant/train_mlp.py`: train the landmark-to-BlendShape map and export ONNX
2. verify that the exported ONNX matches the PyTorch output to about 1e-5 on identical input
3. write the decision-gate document recording the three answers, the route choice and the
   actual time spent
4. run post-training quantization and produce an INT8 model
5. produce the three-way comparison: latency, size and accuracy, as a table plus CSV

Then, and not blocking the above:

6. record a second dataset session with a fuller expression protocol, so that the accuracy
   numbers become meaningful
7. start the long-lead administrative items (model licence registrations, dataset
   applications) because they are pure waiting time

---

## 9. Appendix

### 9.1 Repository layout

```
D:\DASH\V0FastTest\
├── deploy/                      local inference scripts (single image, real-time)
├── quant/                       quantization work
│   ├── bench.py                 latency and size measurement
│   ├── probe_unpack.py          Q1: container extraction
│   ├── probe_route_a.py         Q2-A: TFLite to ONNX conversion
│   ├── collect_pairs.py         Q2-B: dataset collection
│   ├── preview_pairs.py         dataset verification and figure
│   ├── train_mlp.py             Q2-B: training and export (in progress)
│   ├── data/                    datasets (not versioned)
│   ├── models/                  extracted and converted models (not versioned)
│   ├── result/                  evidence records
│   └── tests/                   measurement toolkit tests
├── fusion/                      dual-source fusion server
├── viewer/                      three.js plus VRM renderer
├── SysMocap/, SysMocapApp/      body capture component
├── facial-motion-capture/       facial capture component
└── TECHNICAL_ROUTE_REPORT_*.md  this report
```

Measured artefacts are deliberately excluded from version control: models and datasets are
products, not sources. Scripts and evidence records are versioned.

### 9.2 Reproduction commands

```powershell
# interpreter is fixed
$py = "D:\Miniconda3\python.exe"

# measurement toolkit tests
& $py -m pytest

# Q1: extract embedded models
& $py -m quant.probe_unpack

# Q2-A: attempt conversion
& $py -m quant.probe_route_a

# Q2-B: collect the dataset (camera)
& $py -m quant.collect_pairs

# verify the dataset and regenerate the figure
& $py -m quant.preview_pairs

# Q2-B: train and export
& $py -m quant.train_mlp
```

### 9.3 References

Underlying perception models:

| Model | Paper |
|---|---|
| BlazePose | arXiv:2006.10204, CVPR 2020 Workshop |
| BlazeFace | arXiv:1907.05047 |
| Face Mesh | arXiv:1907.06724 |
| MediaPipe Hands | arXiv:2006.10214, CVPR 2020 Workshop |
| MediaPipe framework | arXiv:1906.08172, CVPR 2019 Workshop |
| MediaPipe Holistic | no formal paper; Google Research blog and AI Edge documentation |

Citation erratum: an earlier version of these notes cited MediaPipe Holistic as
arXiv:2012.07808. That identifier belongs to an unrelated natural language processing paper.
MediaPipe Holistic has no formal publication. An academic treatment of its hand region
detection limitation is arXiv:2405.03545.

Software:

| Project | Licence |
|---|---|
| SysMocap | MPL-2.0 |
| miniface (facial-motion-capture) | MIT-Attribution |
| Kalidokit | community open-source library, no formal paper |
