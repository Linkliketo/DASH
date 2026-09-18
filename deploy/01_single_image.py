# this program is to introduce the usage of a series of model by understanding a portrait
# this task I should walk through this path
#   1. import the mediapipe model for reasoning and cv2 for understanding picture
#   2. set the path constance
#   3. set up a 3 instances option (from model options, model running to number of face)
#   4. process input of image
#   5. reasoning and print the output

import numpy as np
import mediapipe as mp
import cv2
import os

# these two different way to set the constant path
MODEL_PATH = "D:/DASH/V0FastTest/models/face_landmarker.task"
IMAGE_PATH = r"D:\DASH\V0FastTest\deploy\assets\test_single.jpg"


# test the existence of path
print(os.path.exists(MODEL_PATH), os.path.exists(IMAGE_PATH))

# set options for landmarker (chose hyperparameters of the model)
options = mp.tasks.vision.FaceLandmarkerOptions(
    base_options=mp.tasks.BaseOptions(model_asset_path=MODEL_PATH),
    running_mode=mp.tasks.vision.RunningMode.IMAGE,
    num_faces=1,
    output_face_blendshapes=True
)

with mp.tasks.vision.FaceLandmarker.create_from_options(options) as landmark:

    print("the landmark is {}".format(landmark))

    # read the image by cv2 (note that: if cv2 fails to read the image,
    # it will return "None" rather than print error)
    # and return b-g-r sequence of matrix
    bgr = cv2.imread(IMAGE_PATH)

    if bgr is None:
        print("cv2 read the image path \"{}\" error".format(IMAGE_PATH))
        exit(0)

    print("the shape of bgr is {}".format(bgr.shape))

    # switch g-b-r to r-g-b to follow the pattern
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    # capture thr rgb and format
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB,
                        data=rgb)

    result = landmark.detect(mp_image)

    # process the probability of no face detected
    if len(result.face_landmarks) == 0:
        print("no face detected")
        exit(0)

    print("the attribute in the result is {}".format(dir(result)))
    print("the type of result is {}".format(type(result)))
    print("the number of face is {}".format(len(result.face_landmarks)))
    print("the point of the first face is {}".format(len(result.face_landmarks[0])))
    # output: 478
    # Face Mesh use 468 number of point for pure face without eye detection,
    # FaceLandmarker (use now) use 478 number of point with 10 point, each eye 4+1 (center) point addition
    p = result.face_landmarks[0][0]
    print("get the first point of the first face and f-string -ify is {} {} {} {}".format(p.x, p.y, p.z, p.visibility))
    # the point above is normalized

    # then we visualize the point
    # vectorize first
    pointsData = result.face_landmarks[0]
    points = np.array([[p.x, p.y, p.z] for p in pointsData])
    # first, we should get the height and width of the picture
    H, W = bgr.shape[:2]
    xs = points[:,0]
    ys = points[:,1]
    cx = (xs * W).astype(int)
    cy = (ys * H).astype(int)
    print("have {}/{} (x,y) points".format(len(cx), len(cy)))
    # then we can graw the points one by one (note that should use the bgr tuple)
    for i in range(len(cx)):
        cv2.circle(bgr, (cx[i], cy[i]), 2, (255, 0, 0), -1)
    # save the picture
    cv2.imwrite("output_landmarker.png", bgr)

    # then, it's a good time to check the most active face
    for c in sorted(result.face_blendshapes[0], key=lambda c: c.score, reverse=True)[:10]:
        print(f"{c.category_name:24s} {c.score:.4f}")




