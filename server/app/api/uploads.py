from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import UploadInit
from ..services import chunked_upload
from .deps import ensure_project_access, get_current_user

router = APIRouter()


def _session_or_404(upload_id: str, user: User) -> dict:
    try:
        return chunked_upload.get_session(upload_id, user.id)
    except chunked_upload.UploadSessionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/uploads/init")
def init_upload(
    payload: UploadInit,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """开一个分片上传会话；大文件走这条路，小文件仍可直接 POST /assets。"""
    ensure_project_access(db, payload.project_id, user, write=True)
    meta = chunked_upload.new_session(user.id, payload.file_name, payload.file_size)
    return {**meta, "uploaded": []}


@router.get("/uploads/{upload_id}")
def upload_status(
    upload_id: str,
    user: User = Depends(get_current_user),
):
    """续传前对账：已经收到哪些分片。"""
    meta = _session_or_404(upload_id, user)
    return {**meta, "uploaded": chunked_upload.uploaded_indexes(upload_id)}


@router.post("/uploads/{upload_id}/chunks/{index}")
async def upload_chunk(
    upload_id: str,
    index: int,
    request: Request,
    user: User = Depends(get_current_user),
):
    """收一个分片。用裸 body 而不是 multipart，省掉每片的封装开销。"""
    meta = _session_or_404(upload_id, user)
    if index < 0 or index >= meta["total_chunks"]:
        raise HTTPException(status_code=400, detail="分片序号超出范围")
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="分片内容为空")
    chunked_upload.save_chunk(upload_id, index, data)
    return {"uploaded": chunked_upload.uploaded_indexes(upload_id)}
