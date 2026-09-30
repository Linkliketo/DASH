// 三种输入源的管理：camera(MJPEG) / photo / video，统一收敛到「源画面元素」
import { cameraStreamUrl } from "./api.js";

export class SourceInput {
  constructor({ box, image, video }) {
    this.box = box;       // .source-box 容器
    this.image = image;   // <img>（photo / MJPEG 共用）
    this.video = video;   // <video>
    this.mode = null;     // "camera" | "photo" | "video"
    this._objectUrl = null;
  }

  _resetMedia() {
    this.image.hidden = true;
    this.video.hidden = true;
    this.image.removeAttribute("src");
    this.video.removeAttribute("src");
    this.video.load();
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
    this.box.classList.remove("mirrored");
  }

  // camera：MJPEG 进 <img>；onError 在流不可用时回调（如后端 --no-camera）
  startCamera(onError) {
    this._resetMedia();
    this.mode = "camera";
    this.image.hidden = false;
    this.box.classList.add("mirrored"); // 自拍镜像习惯
    this.image.onerror = () => onError && onError(new Error("摄像头帧流不可用"));
    this.image.src = cameraStreamUrl();
  }

  setPhoto(file) {
    this._resetMedia();
    this.mode = "photo";
    this._objectUrl = URL.createObjectURL(file);
    this.image.hidden = false;
    this.image.src = this._objectUrl;
  }

  setVideo(file) {
    this._resetMedia();
    this.mode = "video";
    this._objectUrl = URL.createObjectURL(file);
    this.video.hidden = false;
    this.video.controls = true;
    this.video.loop = true;
    this.video.src = this._objectUrl;
  }

  activeMedia() {
    if (this.mode === "video") return this.video;
    if (this.mode === "camera" || this.mode === "photo") return this.image;
    return null;
  }

  stop() {
    this._resetMedia();
    this.mode = null;
  }
}
