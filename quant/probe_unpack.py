from datetime import datetime
import zipfile

# in this task we will find that: the compress rates is 1
# (indicate that the ".task" project is just the container of models)
RESOURCE_PATH = r"D:\DASH\V0FastTest\models\face_landmarker.task"
STORAGE_PATH = r"D:\DASH\V0FastTest\quant\models\extracted"
WRITE_PATH = r"D:\DASH\V0FastTest\quant\result\probe_unpack.md"

def unzip(resource_path, storage_path=STORAGE_PATH):

    with zipfile.ZipFile(resource_path) as zf:
        now =  datetime.now()
        result="unzip log at {} \nunzip the {} to the {} \n".format( now, resource_path, storage_path)
        for info in zf.infolist():

            result += ("file name:{}, size: {}, compress_size: {}, compress_type: {}, compress_level: {}\n"
                  .format(info.filename,
                          info.file_size,
                          info.compress_size,
                          info.compress_type,
                          info.compress_level))

            zf.extract(info.filename,storage_path)
        print(result)

    with open(WRITE_PATH, "a", encoding="utf-8") as f:
        f.write(result + "\n")


if __name__ == '__main__':
    unzip(RESOURCE_PATH, STORAGE_PATH)
