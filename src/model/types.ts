export type Mode = 'place' | 'delete' | 'paint' | 'look';

export type Placement = {
  uid: string;
  partId: string;
  x: number;
  y: number;
  z: number;
  /** Joint: index into orientations. Tube: axis 0|1|2. Others: facing. */
  ori: number;
  color: string;
};

export type DesignFile = {
  version: 1;
  name: string;
  pitch: number;
  colorwayId: string;
  rungMm: number;
  placements: Placement[];
};
