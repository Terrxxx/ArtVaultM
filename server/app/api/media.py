"""展示类图片的取图跳转。

存在本地磁盘的图片由 `/uploads` 静态目录直接提供，不走这里；
存在 COS 上的必须先签名才能访问，而**签名是在接口响应生成那一刻定下的**——
前端会把这条链接一直拿着用，过了有效期（几小时）再取就 403，页面上的图就裂了。

所以对外只发一个固定的本站地址，每次真正取图时现签一次再跳过去。
本地存储不受影响（静态目录本来就没有签名）。
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import RedirectResponse

from ..services import storage, storage_config

router = APIRouter()


@router.get("/media/cos/{path:path}")
def cos_media(path: str):
    """把 /api/media/cos/... 跳到一条刚刚签好的 COS 链接上。"""
    cos = storage_config.cached_params()
    if not cos:
        raise HTTPException(status_code=404, detail="对象存储未配置")
    try:
        url = storage.presigned_url(path, cos, storage.DISPLAY_URL_TTL)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"生成图片链接失败：{exc}")
    return RedirectResponse(url=url, status_code=307)
