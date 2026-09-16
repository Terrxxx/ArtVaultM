from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Project, ProjectMember, User
from ..serializers import member_to_dict, project_to_dict
from ..services import badges, notify
from .deps import ensure_project_access, ensure_project_editor, get_current_user

router = APIRouter()


class InviteRequest(BaseModel):
    user_id: int


@router.get("/projects/{project_id}/members")
def list_members(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_project_access(db, project_id, user)
    members = (
        db.query(ProjectMember)
        .filter(ProjectMember.project_id == project_id)
        .order_by(ProjectMember.id)
        .all()
    )
    return {
        "members": [member_to_dict(m) for m in members if m.status == "accepted"],
        "pending": [member_to_dict(m) for m in members if m.status != "accepted"],
    }


@router.post("/projects/{project_id}/members")
def invite_member(
    project_id: int,
    payload: InviteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    project = ensure_project_editor(db, project_id, user)

    target = db.get(User, payload.user_id)
    if target is None or target.status != "active" or target.deleted_at is not None:
        raise HTTPException(status_code=404, detail="用户不存在或已被禁用")
    if target.id == project.owner_id:
        raise HTTPException(status_code=400, detail="该用户已是项目所有者")

    exists = (
        db.query(ProjectMember)
        .filter(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == target.id,
        )
        .first()
    )
    if exists:
        raise HTTPException(
            status_code=400,
            detail="该用户已加入项目" if exists.status == "accepted" else "已邀请该用户，等待对方同意",
        )

    member = ProjectMember(project_id=project_id, user_id=target.id, status="pending")
    db.add(member)

    notify.add_notification(
        db,
        target.id,
        "invite",
        actor_id=user.id,
        project_id=project_id,
        content=f"邀请你加入项目「{project.name}」，等待你确认",
    )
    db.commit()
    db.refresh(member)
    return member_to_dict(member)


@router.delete("/projects/{project_id}/members/{member_id}")
def remove_member(
    project_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ensure_project_editor(db, project_id, user)
    member = db.get(ProjectMember, member_id)
    if member is None or member.project_id != project_id:
        raise HTTPException(status_code=404, detail="成员不存在")
    db.delete(member)
    db.commit()
    return {"ok": True}


# ---------- 邀请的接受 / 拒绝 ----------


@router.get("/invitations")
def my_invitations(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    """我收到的、尚未处理的邀请。"""
    members = (
        db.query(ProjectMember)
        .filter(
            ProjectMember.user_id == user.id,
            ProjectMember.status == "pending",
        )
        .order_by(ProjectMember.id.desc())
        .all()
    )
    result = []
    for m in members:
        project = db.get(Project, m.project_id)
        if project is None:
            continue
        result.append(
            {
                "member_id": m.id,
                "project": {
                    "id": project.id,
                    "name": project.name,
                    "slug": project.slug,
                    "visibility": project.visibility,
                    "owner": {
                        "id": project.owner.id,
                        "username": project.owner.username,
                        "nickname": project.owner.nickname,
                        "avatar": project.owner.avatar,
                    }
                    if project.owner
                    else None,
                },
            }
        )
    return result


@router.post("/invitations/{member_id}/accept")
def accept_invitation(
    member_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = db.get(ProjectMember, member_id)
    if member is None or member.user_id != user.id:
        raise HTTPException(status_code=404, detail="邀请不存在")
    if member.status == "accepted":
        raise HTTPException(status_code=400, detail="已经加入该项目")

    member.status = "accepted"
    project = db.get(Project, member.project_id)

    if project is not None and project.owner_id:
        notify.add_notification(
            db,
            project.owner_id,
            "invite",
            actor_id=user.id,
            project_id=project.id,
            content=f"{user.nickname or user.username} 已接受加入项目「{project.name}」",
        )
        # 「人多势众」这类成就算在项目所有者头上
        badges.sync(db, project.owner_id)

    db.commit()
    return {"ok": True, "project_id": member.project_id}


@router.post("/invitations/{member_id}/decline")
def decline_invitation(
    member_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    member = db.get(ProjectMember, member_id)
    if member is None or member.user_id != user.id:
        raise HTTPException(status_code=404, detail="邀请不存在")
    db.delete(member)
    db.commit()
    return {"ok": True}
