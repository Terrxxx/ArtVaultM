# -*- coding: utf-8 -*-
"""ArtVault 后端冒烟测试：跑通 M1+M2 核心链路。

用法：.venv/Scripts/python.exe smoke_test.py
"""
import io

import requests

BASE = "http://127.0.0.1:130"


def main():
    # 1. 管理员登录
    r = requests.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
    r.raise_for_status()
    admin_token = r.json()["access_token"]
    print("[1] 管理员登录 OK")

    # 2. 管理员创建普通用户
    r = requests.post(
        f"{BASE}/api/admin/users",
        json={"username": "artist01", "password": "123456", "nickname": "美术小张", "role": "member"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    print("[2] 创建用户 artist01 OK")

    # 3. 普通用户登录
    r = requests.post(f"{BASE}/api/auth/login", json={"username": "artist01", "password": "123456"})
    r.raise_for_status()
    user_token = r.json()["access_token"]
    print("[3] 用户登录 OK")

    # 4. 创建项目（自动生成系统分类）
    r = requests.post(
        f"{BASE}/api/projects",
        json={"name": "测试项目", "description": "演示", "github_repo_url": "https://github.com/example/demo", "visibility": "public"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    r.raise_for_status()
    project = r.json()
    pid = project["id"]
    assert len(project["categories"]) == 9, f"分类数量错误: {len(project['categories'])}"
    print(f"[4] 创建项目 OK，自动分类 {len(project['categories'])} 个")

    # 5. 上传资产 v1
    r = requests.post(
        f"{BASE}/api/assets",
        headers={"Authorization": f"Bearer {user_token}"},
        data={
            "project_id": str(pid),
            "category_id": str(project["categories"][0]["id"]),
            "name": "英雄模型",
            "description": "主角模型",
            "tags": "角色,主角",
            "changelog": "初版",
        },
        files={"file": ("hero.fbx", io.BytesIO("version1-content".encode()), "application/octet-stream")},
    )
    r.raise_for_status()
    asset = r.json()
    aid = asset["id"]
    assert asset["latest_version"]["version"] == 1
    print(f"[5] 上传资产 v1 OK（资产 id={aid}）")

    # 6. 上传 v2
    r = requests.post(
        f"{BASE}/api/assets/{aid}/versions",
        headers={"Authorization": f"Bearer {user_token}"},
        data={"changelog": "优化拓扑"},
        files={"file": ("hero.fbx", io.BytesIO("version2-content-improved".encode()), "application/octet-stream")},
    )
    r.raise_for_status()
    v2 = r.json()
    assert v2["version"] == 2 and v2["is_latest"] is True
    print("[6] 上传 v2 OK")

    # 7. 资产详情：最新为 v2，共两个版本
    r = requests.get(f"{BASE}/api/assets/{aid}", headers={"Authorization": f"Bearer {user_token}"})
    r.raise_for_status()
    detail = r.json()
    assert detail["latest_version"]["version"] == 2, detail["latest_version"]
    assert detail["version_count"] == 2
    assert [v["version"] for v in detail["versions"]] == [1, 2]
    print("[7] 资产详情 OK：默认最新 v2，共 2 个版本")

    # 8. 下载最新版本文件
    r = requests.get(f"{BASE}/api/versions/{v2['id']}/download", headers={"Authorization": f"Bearer {user_token}"})
    r.raise_for_status()
    assert r.content.decode() == "version2-content-improved"
    print("[8] 下载最新版本 OK")

    # 9. 评论
    r = requests.post(
        f"{BASE}/api/assets/{aid}/comments",
        json={"content": "这个模型真棒！"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    r.raise_for_status()
    assert r.json()["content"] == "这个模型真棒！"
    print("[9] 评论 OK")

    # 10. 资产列表默认显示最新版本
    r = requests.get(f"{BASE}/api/projects/{pid}/assets", headers={"Authorization": f"Bearer {user_token}"})
    r.raise_for_status()
    assets = r.json()
    assert len(assets) == 1 and assets[0]["latest_version"]["version"] == 2
    print("[10] 资产列表默认最新版本 OK")

    print("\n=== 全部冒烟测试通过 ===")


if __name__ == "__main__":
    main()
