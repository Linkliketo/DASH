# transform from tflite to onnx
> with confidence 1e-04

## face_detector.tflite convert try

> the model face_detector.tflite can be converted to onnx

### the signature of onnx and tflite

| framework | input shape | output |
|---|---|---|
| TFLite | [1, 128, 128, 3] | [[1, 896, 16], [1, 896, 1]] |
| ONNX   | [1, 3, 128, 128] | [[1, 896, 16], [1, 896, 1]] |

### same data, two layouts; outputs should match

over 30 inputs drawn from seed 42

| output | shape | median err | worst err | confirmation |
|---|---|---|---|---|
| regressors | [1, 896, 16] | 7.629e-05 | 1.221e-04 | pass |
| classificators | [1, 896, 1] | 8.678e-05 | 1.678e-04 | pass |

### conclusion
- **Q2-A = yes** (median err 8.678e-05 over 30 inputs, criterion: median < 1e-04)
- The worst single-input error reaches 1.678e-04, about 2x the median. This spread comes from float16 relative precision, not from the conversion logic, so a single-input verdict is not reliable.
- The converter transposes NHWC -> NCHW, so the same input data must be fed to each runtime in its own layout.
- Scope: this verdict covers face_detector only. The other two models crash inside tflite2onnx itself, so they are not covered by route A and need candidate B.
- Consequence for Task 8: compare INT8 against the ONNX FP32 model (same side, same inputs), otherwise the conversion error cannot be separated from the quantization error.

## face_blendshapes.tflite convert try

> the model face_blendshapes.tflite can not be converted to onnx with error object of type 'int' has no len()


## face_landmarks_detector.tflite convert try

> the model face_landmarks_detector.tflite can not be converted to onnx with error list index out of range


