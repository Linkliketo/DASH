"""视频文件 → YUV420 .y4m（供 Chrome --use-file-for-fake-video-capture 使用）
用法: python video_to_y4m.py input.mp4 [output.y4m] [WxH] [fps] [秒数] [循环次数]
默认取前 5 秒、不循环（y4m 无压缩，几秒≈几十MB；循环会让体积线性增长）。
"""
import sys, imageio_ffmpeg, subprocess

def main():
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else src.rsplit(".", 1)[0] + ".y4m"
    size = sys.argv[3] if len(sys.argv) > 3 else "640x480"
    fps = sys.argv[4] if len(sys.argv) > 4 else "30"
    dur = sys.argv[5] if len(sys.argv) > 5 else "5"      # 取前 N 秒
    loop = sys.argv[6] if len(sys.argv) > 6 else "1"     # 循环次数（默认不循环）
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    size2 = size.replace("x", ":")
    cmd = [
        ffmpeg, "-stream_loop", loop, "-t", dur, "-i", src,
        "-vf", f"scale={size2}:force_original_aspect_ratio=decrease,pad={size2}:(ow-iw)/2:(oh-ih)/2",
        "-r", fps, "-pix_fmt", "yuv420p", "-f", "yuv4mpegpipe", "-y", out,
    ]
    print(">", " ".join(cmd))
    subprocess.run(cmd, check=True)
    print(f"[OK] {out}")

if __name__ == "__main__":
    main()
