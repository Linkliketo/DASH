import faulthandler
import os
import sys
faulthandler.dump_traceback_later(3, repeat=False)
import mediapipe as mp
import cv2

from quant.bench import measure_latency

IMAGE_PATH = r"D:\DASH\V0FastTest\deploy\assets\test_single.jpg"
MODEL_PATH = r"D:\DASH\V0FastTest\models\face_landmarker.task"

def run_calibration():
    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=MODEL_PATH),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_faces=1,
        output_face_blendshapes=True
    )
    bgr = cv2.imread(IMAGE_PATH)
    if bgr is None:
        raise FileNotFoundError("could not read the image form {}.".format(IMAGE_PATH))
    image = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB,
                        data=image)

    # shouldn't use "with", the create_from_options is based on c++, it might get sucked for some reason
    landmark = mp.tasks.vision.FaceLandmarker.create_from_options(options)
    def infer_once():
        return landmark.detect(mp_image)
    latency = measure_latency(run_once=infer_once, n_runs=100, n_warmup=10)
    print("the latency is {} ms, the p95_ms is {} ms, the p50_ms is {} ms, the min_ms is {} ms".format(latency["mean_ms"], latency["p95_ms"], latency["p50_ms"], latency["min_ms"]))
    # this two code below should be just added at the end of the process
    sys.stdout.flush()
    os._exit(0)

if __name__ == '__main__':
    run_calibration()