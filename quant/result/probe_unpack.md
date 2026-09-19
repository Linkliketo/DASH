# Quantization1 information

## procession 1: unzip the "[face_landmarker.task](../../models/face_landmarker.task)" model

in this task, we unzip the .task model to the "quant/models/extracted" file by the "quant/probe_unpack.py" python script

then get models below
* face_detector.tflite                            229,746 B  (STORED)
* face_landmarks_detector.tflite                2,553,590 B  (STORED)
* geometry_pipeline_metadata_landmarks.binarypb    19,376 B  (STORED)
* face_blendshapes.tflite                         955,312 B  (STORED)

* sum                                           3,758,024 B
* ZIP container cost                                  572 B
* = .task size                                  3,758,596 B 

get 3 different .tflite model

## LOG

unzip log at 2026-09-19 15:26:03.748363 
unzip the D:\DASH\V0FastTest\models\face_landmarker.task to the D:\DASH\V0FastTest\quant\models\extracted 
file name:face_detector.tflite, size: 229746, compress_size: 229746, compress_type: 0, compress_level: None
file name:face_landmarks_detector.tflite, size: 2553590, compress_size: 2553590, compress_type: 0, compress_level: None
file name:geometry_pipeline_metadata_landmarks.binarypb, size: 19376, compress_size: 19376, compress_type: 0, compress_level: None
file name:face_blendshapes.tflite, size: 955312, compress_size: 955312, compress_type: 0, compress_level: None

unzip log at 2026-09-19 15:28:13.917145 
unzip the D:\DASH\V0FastTest\models\face_landmarker.task to the D:\DASH\V0FastTest\quant\models\extracted 
file name:face_detector.tflite, size: 229746, compress_size: 229746, compress_type: 0, compress_level: None
file name:face_landmarks_detector.tflite, size: 2553590, compress_size: 2553590, compress_type: 0, compress_level: None
file name:geometry_pipeline_metadata_landmarks.binarypb, size: 19376, compress_size: 19376, compress_type: 0, compress_level: None
file name:face_blendshapes.tflite, size: 955312, compress_size: 955312, compress_type: 0, compress_level: None

unzip log at 2026-09-19 15:30:51.762372 
unzip the D:\DASH\V0FastTest\models\face_landmarker.task to the D:\DASH\V0FastTest\quant\models\extracted 
file name:face_detector.tflite, size: 229746, compress_size: 229746, compress_type: 0, compress_level: None
file name:face_landmarks_detector.tflite, size: 2553590, compress_size: 2553590, compress_type: 0, compress_level: None
file name:geometry_pipeline_metadata_landmarks.binarypb, size: 19376, compress_size: 19376, compress_type: 0, compress_level: None
file name:face_blendshapes.tflite, size: 955312, compress_size: 955312, compress_type: 0, compress_level: None

