"""Train a tiny CNN document-type classifier and export to ONNX.

Produces  app/static/models/doc_type.onnx

Data layout (pass via --data):
    data/
      passport/         *.png
      national_id/      *.png
      utility_bill/     *.png
      loan_application/ *.png
      other/            *.png

Designed for tiny datasets (~50 images / class). For production accuracy,
replace the model with a fine-tuned EfficientNet-lite and export the same way.

Requires: torch, torchvision (install separately — not in base requirements).
"""
import argparse, sys
from pathlib import Path

LABELS = ["passport", "national_id", "utility_bill", "loan_application", "other"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data")
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--out", default="app/static/models/doc_type.onnx")
    args = ap.parse_args()

    try:
        import torch
        import torch.nn as nn
        from torch.utils.data import DataLoader
        from torchvision import datasets, transforms
    except Exception as e:
        print(f"PyTorch not installed: {e}\n  pip install torch torchvision")
        sys.exit(1)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    tfm = transforms.Compose([
        transforms.Grayscale(), transforms.Resize((224, 224)),
        transforms.ToTensor(),
    ])
    ds = datasets.ImageFolder(args.data, transform=tfm)
    dl = DataLoader(ds, batch_size=16, shuffle=True)

    class TinyCNN(nn.Module):
        def __init__(self, n):
            super().__init__()
            self.net = nn.Sequential(
                nn.Conv2d(1, 16, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
                nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(), nn.MaxPool2d(2),
                nn.Conv2d(32, 64, 3, padding=1), nn.ReLU(), nn.AdaptiveAvgPool2d(1),
                nn.Flatten(), nn.Linear(64, n),
            )
        def forward(self, x): return self.net(x)

    model = TinyCNN(len(LABELS))
    opt = torch.optim.Adam(model.parameters(), lr=2e-3)
    loss = nn.CrossEntropyLoss()

    for ep in range(args.epochs):
        total = 0.0
        for x, y in dl:
            opt.zero_grad()
            l = loss(model(x), y)
            l.backward(); opt.step()
            total += l.item()
        print(f"epoch {ep+1}/{args.epochs}  loss={total/len(dl):.4f}")

    # Export
    dummy = torch.zeros(1, 1, 224, 224)
    torch.onnx.export(
        model, dummy, out_path, input_names=["input"],
        output_names=["logits"], opset_version=17,
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
    )
    print(f"Wrote {out_path} ({out_path.stat().st_size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
