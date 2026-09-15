from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Asset, AssetRelation, User
from ..schemas import RelationCreate
from ..serializers import asset_to_dict
from .deps import ensure_project_access, get_current_user

router = APIRouter()


def _get_asset_or_404(db: Session, asset_id: int) -> Asset:
    asset = db.get(Asset, asset_id)
    if asset is None:
        raise HTTPException(status_code=404, detail="资产不存在")
    return asset


@router.get("/assets/{asset_id}/relations")
def list_relations(
    asset_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = _get_asset_or_404(db, asset_id)
    ensure_project_access(db, asset.project_id, user)

    relations = (
        db.query(AssetRelation)
        .filter(
            (AssetRelation.from_asset_id == asset_id)
            | (AssetRelation.to_asset_id == asset_id)
        )
        .all()
    )

    result = []
    for r in relations:
        outgoing = r.from_asset_id == asset_id
        other = r.to_asset if outgoing else r.from_asset
        if other is None:
            continue
        result.append(
            {
                "id": r.id,
                "relation_type": r.relation_type,
                "direction": "out" if outgoing else "in",
                "asset": asset_to_dict(other, current_user_id=user.id),
            }
        )
    return result


@router.post("/assets/{asset_id}/relations")
def add_relation(
    asset_id: int,
    payload: RelationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = _get_asset_or_404(db, asset_id)
    ensure_project_access(db, asset.project_id, user, write=True)

    if payload.to_asset_id == asset_id:
        raise HTTPException(status_code=400, detail="不能关联资产自身")

    target = _get_asset_or_404(db, payload.to_asset_id)
    ensure_project_access(db, target.project_id, user)

    exists = (
        db.query(AssetRelation)
        .filter(
            AssetRelation.from_asset_id == asset_id,
            AssetRelation.to_asset_id == payload.to_asset_id,
        )
        .first()
    )
    if exists:
        raise HTTPException(status_code=400, detail="已经关联过了")

    relation = AssetRelation(
        from_asset_id=asset_id,
        to_asset_id=payload.to_asset_id,
        relation_type=payload.relation_type or "related",
    )
    db.add(relation)
    db.commit()
    db.refresh(relation)
    return {"id": relation.id, "ok": True}


@router.delete("/relations/{relation_id}")
def delete_relation(
    relation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    relation = db.get(AssetRelation, relation_id)
    if relation is None:
        raise HTTPException(status_code=404, detail="关联不存在")
    ensure_project_access(db, relation.from_asset.project_id, user, write=True)
    db.delete(relation)
    db.commit()
    return {"ok": True}
