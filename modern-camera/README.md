# modern-camera

app gui

```
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

nvm

npm install

sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
librsvg2-dev

# 解决雪花条纹
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev

fn main() {
    // 修复 Linux/树莓派上的渲染花屏问题
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    tauri::Builder::default()
        // ... 其他代码
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

```

## Raspberry Pi (rpicam) 使用说明

- Raspberry Pi OS Bookworm 使用 `rpicam-*` 应用名称；旧版本可能仍是 `libcamera-*` 名称（系统提供符号链接）。
- 本应用在树莓派上优先调用 `rpicam-hello`、`rpicam-still`、`rpicam-vid` 进行预览、拍照和录像。
- 若系统未检测到 rpicam，将自动回退为浏览器摄像头（`getUserMedia`）。

### 依赖安装

```bash
sudo apt update
sudo apt install rpicam-apps  # Bookworm 默认已包含，若缺失请安装
```

### 运行应用

开发模式（前端预览）：

```bash
npm install
npm run dev
# 打开 http://localhost:1420
```

Tauri 原生窗口（建议在树莓派上使用）：

```bash
npm run tauri dev
```

### 功能说明

- 预览：使用 `rpicam-hello --timeout 0`，预览在系统窗口显示。
- 拍照：使用 `rpicam-still -o <文件>`，图片默认保存到 `~/Pictures/modern-camera/`。
- 录像：使用 `rpicam-vid -o <文件> --timeout 0`，点击停止结束录像。
- 媒体库：读取上述目录文件并支持点击打开。

参考文档：
- Raspberry Pi 官方文档（Camera software）：https://www.raspberrypi.com/documentation/computers/camera_software.html

```
rsync -avz --progress --filter=':- .gitignore' --exclude='.git' /Users/lixumin/Desktop/projects/imx283-camera-diy/modern-camera/ lismin@192.168.1.13:/home/lismin/projects/modern-camera
```