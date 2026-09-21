import msvcrt

from quant.probe_route_a import QUANT_DIR

# this file we need to compress the video or realtime camera input to point
# need to mention that: it's project is similar with the project of 02_realtime.py

# this part, we start going into the real time capture face or video capture
import time
import mediapipe as mp
import numpy as np
import cv2
from pathlib import Path

ROOT_DIR = Path("D:/DASH/V0FastTest")
MODEL_PATH = ROOT_DIR / "models" / "face_landmarker.task"

DATA_DIR = QUANT_DIR / "data"
PAIRS_PATH = DATA_DIR / "pairs.npz"

VIDEO_PATH = 0
SAMPLE_FRAME_RATE=30

MAX_FRAME = 1500
TOLERANCE_FRAME_LOSS = 0.7

WIN_NAME = "DASH collect"
cv2.namedWindow(WIN_NAME, cv2.WINDOW_AUTOSIZE)

def stop_requested():
    #  OpenCV
    if cv2.waitKey(1) & 0xFF == ord('q'):
        return True
    #  terminal
    if msvcrt.kbhit():
        if msvcrt.getch().lower() == b'q':
            return True
    return False

def ensure_parent(file_path):
    file_path.parent.mkdir(parents=True, exist_ok=True)

def get_landmarks(model_path, video_path):
    frame_index = 0
    features = []
    labels = []
    time_counter = time.perf_counter()

    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=model_path),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_faces=1,
        output_face_blendshapes=True
    )

    with mp.tasks.vision.FaceLandmarker.create_from_options(options=options) as landmark:
        cap = cv2.VideoCapture(video_path)
        time_record = time.perf_counter()

        try:

            while frame_index < MAX_FRAME:

                # read the video
                ret, frame = cap.read()

                if not ret:
                    print( "the camera is closed" if video_path == 0 else "empty video path")
                    break
                cv2.imshow(WIN_NAME, frame)

                # controlled by keyboard
                if stop_requested():
                    print("stopped by \"q\"")
                    break

                # convert the bgr pattern to rgb
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

                # process the timestamp
                timestamp_ms = int((time.perf_counter() - time_counter) * 1000)
                frame_index += 1

                # compute
                results = landmark.detect_for_video(mp_image, timestamp_ms=timestamp_ms)

                # sampling
                if frame_index % SAMPLE_FRAME_RATE == 0:

                    # FPS detector
                    now = time.perf_counter()
                    print("the hardwave of camera has {:.1f} FPS, second gap: {}".format(SAMPLE_FRAME_RATE / (now - time_record), now - time_record))
                    time_record = now
                    print("at the frame of {}, the timestamp is {}".format(frame_index, timestamp_ms))

                    if len(results.face_landmarks) == 0:
                        print("no face detected")
                    else:
                        print("detected {} faces".format(len(results.face_landmarks)))

                if len(results.face_landmarks) > 0:
                    points = np.array([[p.x, p.y, p.z] for p in results.face_landmarks[0]])
                    features.append(points.reshape(-1))
                    labels.append([c.score for c in results.face_blendshapes[0]])
                else:
                    print( "at the {}-th frame, no face detected".format(frame_index))
                    continue

        finally:
            cap.release()
            cv2.destroyAllWindows()
    features = np.array(features,dtype=np.float32)
    labels = np.array(labels,dtype=np.float32)
    return features, labels

def confirm(features, labels):
    result = []
    if len(features) == 0:
        result.append("no samples collected at all")
        return result

    if len(features) == len(labels):
        result.append("the len of features and labels is same. ({})".format(len(features)))
    else:
        result.append("the len of features and labels is different. (features: {}, labels: {})".format(len(features), len(labels)))
    if len(features) > int(TOLERANCE_FRAME_LOSS*MAX_FRAME):
        result.append("the size of features and labels is correct. ({})".format(len(features)))
    else:
        result.append("the size of features and labels is not enough. (output: {}, given frames: {}, should be more than: {})".format(len(features), MAX_FRAME, int(TOLERANCE_FRAME_LOSS*MAX_FRAME)))


    if features[0].shape != (1434,):
        result.append("the shape of features is wrong. (shape: {}, expectation: {})".format(features[0].shape, "(1434,)"))
    else:
        result.append("the shape of features is right. (shape: {})".format(features[0].shape))
    if labels[0].shape != (52,):
        result.append("the shape of labels is wrong. (shape: {}, expectation: {})".format(labels[0].shape, "(52,)"))
    else:
        result.append("the shape of labels is right. (shape: {})".format(labels[0].shape))

    return result


def main():
    ensure_parent(PAIRS_PATH)
    features, labels = get_landmarks(model_path=str(MODEL_PATH), video_path=VIDEO_PATH)
    result = confirm(features, labels)
    print("\n".join(result))
    np.savez_compressed(PAIRS_PATH, features=features, labels=labels)


if __name__ == '__main__':
    main()