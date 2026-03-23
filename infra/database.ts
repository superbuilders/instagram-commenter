import { vpc } from "./vpc";

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
  subnetIds: vpc.privateSubnets,
});

export const db = new aws.rds.Instance("Database", {
  engine: "postgres",
  engineVersion: "16.4",
  instanceClass: "db.t4g.micro",
  allocatedStorage: 20,
  dbName: "instagram_commenter",
  username: "app",
  manageMasterUserPassword: true,
  dbSubnetGroupName: dbSubnetGroup.name,
  vpcSecurityGroupIds: [dbSg.id],
  skipFinalSnapshot: true,
  publiclyAccessible: false,
});
