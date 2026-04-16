from typing import List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..services.auth import require, Principal
from ..services.federated import local_train, fedavg, save_global, load_global, predict

router = APIRouter(prefix="/api/v1/federated", tags=["federated-learning"])


class Update(BaseModel):
    n_samples: int
    weights: list[float]
    branch_id: str | None = None


class AggregateIn(BaseModel):
    round: int
    updates: List[Update]


@router.post("/local-train")
def train(db: Session = Depends(get_db),
          p: Principal = Depends(require("admin"))):
    return local_train(db, tenant=p.tenant)


@router.post("/aggregate")
def aggregate(body: AggregateIn,
              p: Principal = Depends(require("admin"))):
    weights = fedavg([u.model_dump() for u in body.updates])
    save_global(weights, body.round)
    return {"round": body.round,
            "n_branches": len([u for u in body.updates if u.n_samples > 0]),
            "weights": weights}


@router.get("/global")
def global_model(p: Principal = Depends(require("view"))):
    g = load_global()
    if not g:
        raise HTTPException(404, "No global model yet")
    return g


@router.get("/predict/{doc_id}")
def fraud_predict(doc_id: int, db: Session = Depends(get_db),
                  p: Principal = Depends(require("approve"))):
    return predict(db, doc_id)
