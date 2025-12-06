#include <SDL2/SDL.h>
#include <SDL2/SDL_ttf.h>
#include <iostream>
#include <string>
#include <ctime>
#include <unistd.h>
#include <signal.h>
#include <sys/wait.h>

// --- 配置常量 ---
const int WINDOW_WIDTH = 320;
const int WINDOW_HEIGHT = 180;
const char* FONT_PATH = "font.ttf";

// 全局变量
pid_t camera_pid = -1;

// 函数：生成带时间戳的文件名
std::string generate_timestamped_filename() {
    time_t now = time(nullptr);
    struct tm *tstruct = localtime(&now);
    char buffer[80];
    strftime(buffer, sizeof(buffer), "photo_%Y-%m-%d_%H-%M-%S.jpg", tstruct);
    return std::string(buffer);
}

// 函数：启动 rpicam-still 进程
pid_t start_camera_process(const std::string& output_filename) {
    pid_t pid = fork();
    if (pid == -1) {
        std::cerr << "错误: fork() 失败" << std::endl;
        return -1;
    } 
    if (pid == 0) { // 子进程
        char* args[] = {
            (char*)"rpicam-still", "-t", (char*)"0", "-s",
            (char*)"--viewfinder-width", (char*)"800",
            (char*)"--viewfinder-height", (char*)"600",
            (char*)"--vflip", (char*)"--hflip",
            (char*)"-o", (char*)output_filename.c_str(), nullptr
        };
        execvp(args[0], args);
        exit(EXIT_FAILURE);
    } 
    std::cout << "新的 rpicam-still 进程已启动 (PID: " << pid << "), 准备保存为: " << output_filename << std::endl;
    return pid;
}

// 函数：清理子进程
void cleanup_camera_process() {
    if (camera_pid > 0) {
        if (waitpid(camera_pid, NULL, WNOHANG) == 0) {
            std::cout << "正在终止 rpicam-still 进程 (PID: " << camera_pid << ")" << std::endl;
            kill(camera_pid, SIGTERM);
            waitpid(camera_pid, NULL, 0);
        }
    }
}

int main(int argc, char* argv[]) {
    atexit(cleanup_camera_process);

    if (SDL_Init(SDL_INIT_VIDEO) != 0 || TTF_Init() != 0) return 1;

    SDL_Window* window = SDL_CreateWindow("拍照控制器", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, WINDOW_WIDTH, WINDOW_HEIGHT, SDL_WINDOW_SHOWN);
    SDL_Renderer* renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED);
    
    TTF_Font* font = TTF_OpenFont(FONT_PATH, 24);
    if (!font) { std::cerr << "加载字体失败" << std::endl; return 1; }

    // --- 修改部分: 只创建一个纹理 ---
    SDL_Color textColor = { 255, 255, 255, 255 }; // 白色文字
    SDL_Surface* textSurface = TTF_RenderText_Blended(font, "拍 照", textColor);
    SDL_Texture* textTexture = SDL_CreateTextureFromSurface(renderer, textSurface);
    
    // 定义按钮和文字的矩形区域
    SDL_Rect buttonRect = { (WINDOW_WIDTH - (textSurface->w + 40)) / 2, (WINDOW_HEIGHT - (textSurface->h + 20)) / 2, textSurface->w + 40, textSurface->h + 20 };
    SDL_Rect textRect = { buttonRect.x + 20, buttonRect.y + 10, textSurface->w, textSurface->h };

    SDL_FreeSurface(textSurface); // surface不再需要，可以释放

    // 核心逻辑
    std::string next_photo_filename = generate_timestamped_filename();
    camera_pid = start_camera_process(next_photo_filename);
    if (camera_pid == -1) return 1;

    bool is_capturing = false;
    bool running = true;
    SDL_Event event;

    while (running) {
        // 1. 处理事件
        while (SDL_PollEvent(&event)) {
            if (event.type == SDL_QUIT) {
                running = false;
            }
            if (event.type == SDL_MOUSEBUTTONDOWN && !is_capturing) {
                int mouseX, mouseY;
                SDL_GetMouseState(&mouseX, &mouseY);
                if (mouseX >= buttonRect.x && mouseX <= buttonRect.x + buttonRect.w &&
                    mouseY >= buttonRect.y && mouseY <= buttonRect.y + buttonRect.h) 
                {
                    kill(camera_pid, SIGUSR1);
                    is_capturing = true; // 进入捕获状态
                }
            }
        }

        // 2. 状态更新
        if (is_capturing) {
            int status;
            pid_t result = waitpid(camera_pid, &status, WNOHANG);
            if (result == camera_pid) {
                std::cout << "照片已保存! 重启摄像头预览..." << std::endl;
                next_photo_filename = generate_timestamped_filename();
                camera_pid = start_camera_process(next_photo_filename);
                if (camera_pid == -1) running = false;
                is_capturing = false; // 回到准备状态
            }
        }

        // 3. 渲染画面 --- 修改部分 ---
        SDL_SetRenderDrawColor(renderer, 30, 30, 45, 255); // 背景色
        SDL_RenderClear(renderer);

        // 根据状态设置按钮颜色
        if (is_capturing) {
            SDL_SetRenderDrawColor(renderer, 80, 80, 80, 255); // 灰色 (处理中)
        } else {
            SDL_SetRenderDrawColor(renderer, 0, 120, 215, 255); // 蓝色 (准备就绪)
        }
        
        // 绘制按钮背景
        SDL_RenderFillRect(renderer, &buttonRect);
        
        // 始终绘制相同的文字纹理
        SDL_RenderCopy(renderer, textTexture, NULL, &textRect);
        
        SDL_RenderPresent(renderer);
        SDL_Delay(16);
    }

    // 清理资源
    SDL_DestroyTexture(textTexture); // --- 修改部分: 只销毁一个纹理 ---
    TTF_CloseFont(font);
    SDL_DestroyRenderer(renderer);
    SDL_DestroyWindow(window);
    TTF_Quit();
    SDL_Quit();

    std::cout << "程序退出。" << std::endl;
    return 0;
}