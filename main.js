// ================================
// Drive Game - Main
// ================================

// 앞으로 만들 모듈
import { initScene } from "./js/scene.js";
import { initRenderer } from "./js/renderer.js";
import { initCamera } from "./js/camera.js";
import { loadMap } from "./js/map.js";
import { loadPlayer } from "./js/player.js";
import { startGameLoop } from "./js/game.js";


// ================================
// HTML 요소
// ================================

const menu = document.getElementById("menu");
const startButton = document.getElementById("startButton");
const gameContainer = document.getElementById("gameContainer");


// ================================
// 게임 상태
// ================================

let gameStarted = false;


// ================================
// 시작 버튼
// ================================

startButton.addEventListener("click", startGame);


// ================================
// 게임 시작
// ================================

async function startGame() {

    if (gameStarted) return;

    gameStarted = true;

    // 메뉴 숨김
    menu.style.display = "none";

    // 게임 화면 표시
    gameContainer.style.display = "block";

    console.log("===== Drive Game Start =====");

    // 1. Scene 생성
    const scene = initScene();

    // 2. Renderer 생성
    const renderer = initRenderer(gameContainer);

    // 3. Camera 생성
    const camera = initCamera();

    // 4. Map 불러오기
    await loadMap(scene);

    // 5. Player 차량 불러오기
    const player = await loadPlayer(scene);

    // 6. 게임 루프 시작
    startGameLoop(scene, camera, renderer, player);

}
