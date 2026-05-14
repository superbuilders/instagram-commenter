import { vpc } from "./vpc";

const stagePrefix = `${$app.name}-${$app.stage}`;
const isLegacyDevStage = $app.stage === "dev";
const dbSubnetGroupName = isLegacyDevStage
  ? "instagram-commenter-db-subnet-group"
  : `${stagePrefix}-db-subnet-group`;
const dbIdentifier = isLegacyDevStage
  ? "ig-commenter-dev"
  : `${stagePrefix}-db`;

const dbSg = new aws.ec2.SecurityGroup("DbSg", {
  vpcId: vpc.id,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 5432,
      toPort: 5432,
      cidrBlocks: [$interpolate`${vpc.nodes.vpc.cidrBlock}`],
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});

const dbSubnetGroup = new aws.rds.SubnetGroup("DbSubnetGroup", {
  name: dbSubnetGroupName,
  subnetIds: vpc.privateSubnets,
});

const dbPassword = new sst.Secret("DatabasePassword");

export const db = new aws.rds.Instance("Database", {
  identifier: dbIdentifier,
  engine: "postgres",
  engineVersion: "16.4",
  instanceClass: "db.t4g.micro",
  allocatedStorage: 20,
  dbName: "instagram_commenter",
  username: "app",
  password: dbPassword.value,
  dbSubnetGroupName: dbSubnetGroup.name,
  vpcSecurityGroupIds: [dbSg.id],
  skipFinalSnapshot: true,
  publiclyAccessible: false,
});

export { dbPassword };
