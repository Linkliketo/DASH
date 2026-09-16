# this part, we start going into the real time capture face or video capture
import time

import mediapipe as mp
import numpy as np
import cv2

# first, the video capture should be coded

# start, the constant path should be called
MODEL_PATH = r"D:\DASH\V0FastTest\models\face_landmarker.task"
VIDEO_PATH = 0

frame_index = 0
total_infer_time = 0
sample_order = 0
max_sample_number = 3
time_counter = time.perf_counter()

options = mp.tasks.vision.FaceLandmarkerOptions(
    base_options=mp.tasks.BaseOptions(model_asset_path=MODEL_PATH),
    running_mode=mp.tasks.vision.RunningMode.VIDEO,
    num_faces=1,
    output_face_blendshapes=True
)

with mp.tasks.vision.FaceLandmarker.create_from_options(options=options) as landmark:
    time_record = time.perf_counter()
    cap = cv2.VideoCapture(VIDEO_PATH)
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("the camera is closed")
                break

            # start write the function of video processing

            # first, color transmit from bgr to rgb
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            # then, warp it
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

            # process the timestamp
            timestamp_ms = int((time.perf_counter() - time_counter) * 1000)
            frame_index += 1

            # compute the pure reasoning time
            t0 = time.perf_counter()
            results = landmark.detect_for_video(mp_image, timestamp_ms=timestamp_ms)
            infer_time = time.perf_counter() - t0
            total_infer_time += infer_time

            # we detect the output every 100 frames
            if frame_index % 100 == 0:
                # FPS detector
                now = time.perf_counter()
                print("the hardwave of camera has {:.1f} FPS".format(100/(now - time_record)))
                time_record = now
                print("at the frame of {}, the timestamp is {}".format(frame_index, timestamp_ms))

                if len(results.face_landmarks) == 0:
                    print("no face detected")
                else:
                    print("detected {} faces".format(len(results.face_landmarks)))
                print("the average time of reasoning last {} frames is {}".format(frame_index, total_infer_time / frame_index))

                # then, start drawing the sampling picture
                if sample_order < max_sample_number and len(results.face_landmarks) > 0:
                    points = np.array([[p.x,p.y,p.z] for p in results.face_landmarks[0]])
                    H, W = rgb.shape[:2]
                    points[:,0] *= W
                    points[:,1] *= H
                    for p in points:
                        cv2.circle(frame, (int(p[0]), int(p[1])), 1, (0,0,255), -1)
                    frame_name = str(frame_index) + "th-frame.png"
                    cv2.imwrite(frame_name, frame)
                    sample_order += 1
    finally:
        cap.release()